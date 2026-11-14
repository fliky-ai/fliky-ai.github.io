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
    WEB_URL          адрес фронтенда (по умолчанию https://dicegram.dpdns.org/)
    PUBLIC_BASE      домен публичных ссылок (по умолчанию https://dicegram.dpdns.org)
    BOT_APP_LINK     прямая ссылка Mini App https://t.me/<bot>/<app> (скрывает WEB_URL в кнопке бота)
    CORS_ORIGINS     дополнительные origin через запятую (https://dicegram.dpdns.org и https://fliky-ai.github.io разрешены всегда)
    TRUST_PROXY      1 — доверять X-Forwarded-For (ставь 1, если сервер стоит за прокси хостинга:
                     иначе у всех пользователей будет один и тот же IP и общий лимит запросов)
    PROXY_HOPS       сколько прокси стоит перед сервером (по умолчанию 1; нужно только при TRUST_PROXY=1)
    WS_LEGACY_TOKEN  1 — разрешить старый вход по ?token= в WebSocket (по умолчанию 0:
                     новый фронт шлёт токен первым сообщением, а не в адресе)
    SECRET_KEY       ключ Fernet (иначе берётся/создаётся secret.key)
    MAX_UPLOAD_MB    максимальный размер файла в мегабайтах (по умолчанию 50)
    MAX_UPLOAD_PREMIUM_MB  то же для Premium-пользователей (по умолчанию 100; не меньше обычного лимита)
    STT_URL          адрес Whisper-совместимого сервиса распознавания речи (POST multipart: file, model), например
                     https://api.groq.com/openai/v1/audio/transcriptions, https://api.openai.com/v1/audio/transcriptions
                     или свой faster-whisper-server. Без него кнопка «в текст» у голосовых честно сообщает, что сервис не подключён
    STT_API_KEY      ключ для STT_URL (Authorization: Bearer …)
    STT_MODEL        модель (по умолчанию whisper-1), STT_LANG — подсказка языка (например ru), STT_TIMEOUT — секунд (по умолчанию 90)
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

WEB_URL = os.environ.get("WEB_URL", "https://dicegram.dpdns.org/")
PUBLIC_BASE = os.environ.get("PUBLIC_BASE", "https://dicegram.dpdns.org").strip().rstrip("/")   # домен публичных ссылок (только он)
BOT_APP_LINK = os.environ.get("BOT_APP_LINK", "").strip()
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = env_int("PORT", 26033)
ADMIN_TG_ID = env_int("ADMIN_TG_ID", "8771009385")
ADMIN_NUMBER = os.environ.get("ADMIN_NUMBER", "+88888888888")
TON_USD = float(os.environ.get("TON_USD", "3.2"))                 # курс для пересчёта цены коллекционного имени в $, если админ не указал $ сам
NFT_PLATFORM = os.environ.get("NFT_PLATFORM", "Dicegram")         # «приобретено на платформе …» в окне коллекционного имени
TRUST_PROXY = os.environ.get("TRUST_PROXY", "0") == "1"
PROXY_HOPS = max(1, env_int("PROXY_HOPS", 1))
WS_LEGACY_TOKEN = os.environ.get("WS_LEGACY_TOKEN", "0") == "1"

_o = urlparse(WEB_URL)
# Фронтенд может открываться с любого из этих адресов (новый домен или прежний на github.io) — оба разрешены всегда,
# CORS_ORIGINS из окружения только добавляет к ним. Токен идёт в заголовке Authorization (не в cookie), так что это безопасно.
CORS_ORIGINS = list(dict.fromkeys(
    [f"{_o.scheme}://{_o.netloc}", "https://dicegram.dpdns.org", "https://fliky-ai.github.io"]
    + [x.strip().rstrip("/") for x in os.environ.get("CORS_ORIGINS", "").split(",") if x.strip()]))

BASE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE, "messenger.db")
KEY_PATH = os.path.join(BASE, "secret.key")
AVATAR_DIR = os.path.join(BASE, "avatars")
UPLOAD_DIR = os.path.join(BASE, "uploads")
os.makedirs(AVATAR_DIR, exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)
MAX_UPLOAD = max(1, env_int("MAX_UPLOAD_MB", 50)) * 1024 * 1024   # максимальный размер одного файла
MAX_UPLOAD_PREMIUM = max(MAX_UPLOAD, env_int("MAX_UPLOAD_PREMIUM_MB", 100) * 1024 * 1024)   # у Premium — до 100 МБ
STT_URL = os.environ.get("STT_URL", "").strip()                    # распознавание голоса (Whisper-совместимый сервис)
STT_API_KEY = os.environ.get("STT_API_KEY", "").strip()
STT_MODEL = os.environ.get("STT_MODEL", "whisper-1").strip() or "whisper-1"
STT_LANG = os.environ.get("STT_LANG", "").strip()
STT_TIMEOUT = max(5, env_int("STT_TIMEOUT", 90))
STT_MAX = 25 * 1024 * 1024                                          # столько принимают Whisper-сервисы
GIPHY_KEY = os.environ.get("GIPHY_KEY", "").strip()                # ключ для поиска GIF (необязательно)

SYSTEM_ID = 1                        # официальный аккаунт "Dicegram" (служебные уведомления)
SYSTEM_NAME = "Dicegram"
CODE_TTL = 600                       # код живёт 10 минут (человек ходит за ним в Telegram и возвращается)
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
CORS(app, resources={r"/*": {"origins": CORS_ORIGINS}}, max_age=86400, expose_headers=["Content-Range", "Accept-Ranges", "Content-Length"])
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
        expires INTEGER DEFAULT 0, lim INTEGER DEFAULT 0, uses INTEGER DEFAULT 0, revoked INTEGER DEFAULT 0, ts INTEGER, req INTEGER DEFAULT 0);
    CREATE INDEX IF NOT EXISTS ix_cl_chat ON chat_links(chat_id);
    CREATE TABLE IF NOT EXISTS chat_reqs(
        chat_id INTEGER, user_id INTEGER, slug TEXT DEFAULT '', ts INTEGER, PRIMARY KEY(chat_id, user_id));
    CREATE INDEX IF NOT EXISTS ix_cr_chat ON chat_reqs(chat_id, ts);
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
    CREATE TABLE IF NOT EXISTS voice_stt(uid INTEGER, mid INTEGER, text TEXT DEFAULT '', ts INTEGER, PRIMARY KEY(uid, mid));
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
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, token TEXT UNIQUE, install TEXT DEFAULT '', sess TEXT DEFAULT '', ts INTEGER);
    CREATE INDEX IF NOT EXISTS ix_fcm_user ON fcm_tokens(user_id);
    CREATE TABLE IF NOT EXISTS report_files(rid INTEGER, fid TEXT, PRIMARY KEY(rid, fid));
    CREATE INDEX IF NOT EXISTS ix_report_files_fid ON report_files(fid);
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
                            ("game_wallet", "passive_ts", "INTEGER DEFAULT 0"),
                            ("users", "banned", "INTEGER DEFAULT 0"), ("users", "banned_at", "INTEGER DEFAULT 0"),
                            ("users", "ban_backup", "TEXT DEFAULT ''"), ("users", "deleted", "INTEGER DEFAULT 0"),
                            ("reports", "status", "TEXT DEFAULT 'open'"), ("reports", "evidence", "TEXT DEFAULT ''"),
                            ("users", "pbg", "TEXT DEFAULT ''"),
                            ("users", "bio_ents", "TEXT"), ("chat_links", "req", "INTEGER DEFAULT 0"), ("gifts", "tier", "INTEGER DEFAULT 0")):
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
        # коллекционные имена (как в Telegram): хранятся отдельно и НЕ заменяют основной username
        _db.execute("""CREATE TABLE IF NOT EXISTS unames(id INTEGER PRIMARY KEY AUTOINCREMENT, uid INTEGER NOT NULL, name TEXT NOT NULL,
                       ton REAL DEFAULT 0, usd REAL DEFAULT 0, ts INTEGER DEFAULT 0, by INTEGER DEFAULT 0)""")
        _db.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_unames_name ON unames(name COLLATE NOCASE)")
        _db.execute("CREATE INDEX IF NOT EXISTS ix_unames_uid ON unames(uid)")
        # прежняя схема: имя лежало прямо в username с флагом uname_nft → переносим в список коллекционных
        for r in _db.execute("SELECT id, username, uname_ton FROM users WHERE uname_nft=1 AND username != ''").fetchall():
            ton = float(r["uname_ton"] or 0)
            _db.execute("INSERT OR IGNORE INTO unames(uid,name,ton,usd,ts,by) VALUES(?,?,?,?,?,0)",
                        (r["id"], r["username"], ton, round(ton * TON_USD, 2), int(time.time())))
        _db.execute("UPDATE users SET uname_nft=0, uname_ton=0 WHERE uname_nft=1")
    except sqlite3.Error as e:
        print("unames table:", e)
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
    bots_schema(_db)
    try:
        _db.set_progress_handler(_q_guard, 20000)      # см. QUERY_MAX_S
    except Exception as e:
        print("progress handler:", e)


# ── защита от «тяжёлого» запроса: база одна на всех, поэтому запрос дольше QUERY_MAX_S секунд прерывается,
#    иначе один зависший запрос одного человека остановил бы мессенджер для всех ──
QUERY_MAX_S = max(2.0, float(os.environ.get("QUERY_MAX_S", "10") or 10))
_qt = [0.0]


def _q_guard():
    t = _qt[0]
    return 1 if t and time.monotonic() - t > QUERY_MAX_S else 0


def run(sql, args=()):
    with db_lock:
        _qt[0] = time.monotonic()
        try:
            return _db.execute(sql, args)
        except Exception as e:
            print(f"DB Run Error [{sql[:60]}]:", e)
            raise
        finally:
            _qt[0] = 0.0


def q1(sql, args=()):
    with db_lock:
        _qt[0] = time.monotonic()
        try:
            r = _db.execute(sql, args).fetchone()
            return dict(r) if r else None
        except Exception as e:
            print(f"DB Q1 Error [{sql[:60]}]:", e)
            return None
        finally:
            _qt[0] = 0.0


def qa(sql, args=()):
    with db_lock:
        _qt[0] = time.monotonic()
        try:
            return [dict(r) for r in _db.execute(sql, args).fetchall()]
        except Exception as e:
            print(f"DB QA Error [{sql[:60]}]:", e)
            return []
        finally:
            _qt[0] = 0.0


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
        if user.get("banned"):
            tg("sendMessage", chat_id=chat_id, text="⛔️ Ваш аккаунт Dicegram был заблокирован администрацией.")
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
    if not u or u.get("banned") or u.get("deleted"):
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
    if n and n > BODY_MAX and request.endpoint not in ("upload_chunk", "bot_api"):
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


PRIV_KEYS = ("phone", "seen", "photo", "fwd", "calls", "bio", "voice", "msg", "gifts", "invite")
PRIV_DEFAULT = {"phone": "contacts", "seen": "all", "photo": "all", "fwd": "all", "calls": "all", "bio": "all",
                "voice": "all", "msg": "all", "gifts": "all", "invite": "all"}
PRIV_VALUES = ("all", "contacts", "none")
PRIV_VALUES_BY = {"msg": ("all", "cp", "paid")}              # «Сообщения»: все / контакты и Premium / платные (за звёзды)
GIFT_TYPES = ("regular", "rare", "unique", "channels", "premium")   # какие подарки принимать: обычные, редкие, уникальные (NFT), от каналов, Premium
MSG_PRICE_MAX = 35000
GIFT_RARE = set()                                            # ключи «редких» (ограниченных) подарков — заполняется в разделе подарков


def json_load(raw, default):
    try:
        d = json.loads(raw) if raw else default
        return d if isinstance(d, type(default)) else default
    except Exception:
        return default


def priv_of(u):
    d = dict(PRIV_DEFAULT)
    raw = json_load(u.get("priv"), {})
    for k, v in raw.items():
        if k in PRIV_DEFAULT and v in PRIV_VALUES_BY.get(k, PRIV_VALUES):
            d[k] = v
    pr = raw.get("msg_price")
    d["msg_price"] = pr if isinstance(pr, int) and 1 <= pr <= MSG_PRICE_MAX else 0
    gt = raw.get("gtypes")
    d["gtypes"] = [x for x in GIFT_TYPES if x in gt] if isinstance(gt, list) else list(GIFT_TYPES)
    if d["msg"] == "paid" and not d["msg_price"]:
        d["msg"] = "cp"                                       # платный режим без цены не бывает
    return d


def contact_of(owner, other):
    """Есть ли other среди контактов owner: owner сохранил его в контактах или сам ему писал.
    Сообщения, которые other написал первым (в том числе платные), контактом его не делают."""
    return bool(q1("SELECT 1 FROM saved_contacts WHERE owner=? AND contact=?", (owner, other))) or \
        bool(q1("SELECT 1 FROM messages WHERE sender=? AND receiver=? AND COALESCE(kind,'text') NOT IN ('call','gift','svc','greet') LIMIT 1", (owner, other)))


def priv_ok(u, key, viewer):
    """Разрешает ли человек u действие key (voice / gifts / invite) для viewer: все / только контакты / никто."""
    if u.get("is_system") or viewer == u["id"]:
        return True
    v = priv_of(u).get(key, "all")
    if v == "all":
        return True
    if v != "contacts" or not viewer:
        return False
    return contact_of(u["id"], viewer)


def msg_gate(sender, rcv):
    """Кто может писать человеку rcv: None — можно; ("err", текст) — нельзя; ("pay", цена) — только за звёзды.
    Контакты, Premium-отправители и служебные аккаунты проходят бесплатно."""
    if sender["id"] == rcv["id"] or rcv.get("is_system") or sender.get("is_system") or is_admin(sender):
        return None
    p = priv_of(rcv)
    if p["msg"] == "all":
        return None
    if contact_of(rcv["id"], sender["id"]) or is_premium(sender):
        return None
    if p["msg"] == "cp":
        return ("err", "Этот пользователь принимает сообщения только от контактов и подписчиков Premium")
    return ("pay", p["msg_price"])


def gift_kind(key):
    """Тип подарка для настроек приватности: regular / rare / unique / premium."""
    key = str(key or "")
    if key.startswith("prem:"):
        return "premium"
    if key.startswith("c:"):
        return "unique"
    return "rare" if key in GIFT_RARE else "regular"


def gift_gate(sender, rcv, key):
    """Можно ли sender'у подарить rcv подарок key. None — можно, иначе текст отказа."""
    if sender["id"] == rcv["id"] or rcv.get("is_system"):
        return None
    p = priv_of(rcv)
    if not priv_ok(rcv, "gifts", sender["id"]):
        return "Этот пользователь не принимает подарки от вас"
    if gift_kind(key) not in p["gtypes"]:
        return "Этот пользователь не принимает подарки такого типа"
    return None


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


PBG_IDS = ("dark", "red", "blue", "purple", "green", "pink", "orange", "graphite", "light", "cosmic")


def unames_of(uid):
    """Коллекционные имена человека (в порядке выдачи) — для строки «а также @…» и окна «коллекционное имя»."""
    return [{"n": r["name"], "ton": r["ton"] or 0, "usd": r["usd"] or 0, "ts": r["ts"] or 0, "link": link_url(r["name"], "u"),
             "plat": NFT_PLATFORM} for r in qa("SELECT * FROM unames WHERE uid=? ORDER BY id", (uid,))]


def user_by_name(name):
    """Кто скрывается за @именем: основной username или коллекционное имя (заблокированные и удалённые не находятся)."""
    t = q1("SELECT * FROM users WHERE username=? COLLATE NOCASE", (name,))
    if t:
        return t
    return q1("""SELECT u.* FROM unames n JOIN users u ON u.id=n.uid WHERE n.name=? COLLATE NOCASE
                 AND COALESCE(u.banned,0)=0 AND COALESCE(u.deleted,0)=0""", (name,))


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
    if vt in ("major", "official", "blue"):
        d["verified"] = 1
        d["vtier"] = vt
    if u["is_system"]:
        d["number"] = u["number"]
    if u.get("bot"):
        d["bot"] = 1
        bi = bot_info_out(u["id"])
        if bi:
            d["binfo"] = bi
            if not d["bio"]:
                d["bio"] = bi["about"] or ""
    if u.get("banned") or u.get("deleted"):
        d.update(name="Удалённый аккаунт", surname="", username="", bio="", avatar="", online=False, last_seen=0, deleted=1)
        for k in ("verified", "vtier", "owner_theme"):
            d.pop(k, None)
        if not me:
            return d
    if (is_premium(u) or u.get("number") == ADMIN_NUMBER) and u.get("pbg") in PBG_IDS:
        d["pbg"] = u["pbg"]                        # фон профиля (Premium)
    if is_premium(u) and not (u.get("banned") or u.get("deleted")):
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
        if not (u.get("banned") or u.get("deleted")):
            d["unames"] = unames_of(u["id"])
        d["birthday_vis"] = u.get("birthday_vis") or "contacts"
        d["priv"] = priv_of(u)
        d["auto_del"] = u.get("auto_del") or 0
        d["email"] = u.get("login_email") or ""
        d["has_cloud"] = bool(u.get("cloud_hash"))
        d["stars"] = u.get("stars") or 0
        d["premium_until"] = u.get("premium_until") or 0
        d["up_max"] = MAX_UPLOAD_PREMIUM if is_premium(u) else MAX_UPLOAD            # сколько можно загрузить одним файлом
        d["up_max_premium"] = MAX_UPLOAD_PREMIUM
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
        # ограничения, которые человек поставил для меня: клиент заранее знает, что можно (запросы к базе — только если настройка не «все»)
        pv = priv_of(u)
        if pv["voice"] != "all" and not priv_ok(u, "voice", viewer):
            d["no_voice"] = 1
        if pv["msg"] != "all":
            vu = q1("SELECT * FROM users WHERE id=?", (viewer,))
            g_ = msg_gate(vu, u) if vu else None
            if g_ and g_[0] == "err":
                d["no_msg"] = 1
            elif g_:
                d["pay"] = g_[1]
        if pv["gifts"] != "all" or len(pv["gtypes"]) < len(GIFT_TYPES):
            d["gift_ok"] = pv["gtypes"] if priv_ok(u, "gifts", viewer) else []
    if u.get("bot"):
        d.pop("number", None)                      # у бота нет телефонного номера
    if d.get("bio") and u.get("bio_ents"):
        be = json_load(u.get("bio_ents"), [])
        if isinstance(be, list) and be:
            d["bio_ents"] = be[:40]                # свои (Premium) эмодзи в «О себе» — видны всем, кому видно «О себе»
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
        toks = qa("""SELECT f.*, s.token AS alive FROM fcm_tokens f LEFT JOIN sessions s ON s.token=f.sess
                     WHERE f.user_id=?""", (uid,))
        dead = [t["id"] for t in toks if t.get("sess") and not t.get("alive")]
        if dead:
            run(f"DELETE FROM fcm_tokens WHERE id IN ({','.join('?' * len(dead))})", dead)
        toks = [t for t in toks if t["id"] not in dead]
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


def fcm_gc():
    """Токены телефонов, чей сеанс завершён (выход, «завершить другие сеансы», бан), — удаляем."""
    run("DELETE FROM fcm_tokens WHERE sess!='' AND sess NOT IN (SELECT token FROM sessions)")


def has_push(uid):
    """Есть ли у человека хоть один способ получить уведомление вне приложения."""
    return bool(qa("SELECT 1 FROM push_subs WHERE user_id=? LIMIT 1", (uid,)) or
                (fcm_sa() and qa("""SELECT 1 FROM fcm_tokens f LEFT JOIN sessions s ON s.token=f.sess
                                    WHERE f.user_id=? AND (f.sess='' OR s.token IS NOT NULL) LIMIT 1""", (uid,))))


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
    me_d = public(u)
    if not (u.get("banned") or u.get("deleted")):
        me_d["unames"] = unames_of(uid)             # свой список коллекционных имён обновляется сразу после выдачи
    push(uid, {"type": "profile", "user": me_d})
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
    # файл из переписки-доказательства по жалобе — его видят участники admin-panel
    if q1("SELECT 1 FROM report_files WHERE fid=? LIMIT 1", (fid,)) and hc_member(uid):
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
                q1("SELECT 1 FROM report_files WHERE fid=? LIMIT 1", (fid,)) or
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
        if meta.get("pd"):
            d["paid"] = meta["pd"]                 # сообщение отправлено за звёзды (столько звёзд заплатил отправитель)
        if meta.get("cc"):
            d["cc"] = meta["cc"]
        if meta.get("kb") and (row["sender"] == SYSTEM_ID or meta.get("bot")):
            d["kb"] = meta["kb"]                    # кнопки под сообщением бота (админ-панель, Dicebot, пользовательские боты)
        if meta.get("bot"):
            d["bot"] = 1
            if meta.get("rk"):
                d["rk"] = meta["rk"]                # обычная клавиатура бота (вместо поля ввода)
            if meta.get("inv"):
                d["inv"] = meta["inv"]              # счёт на оплату звёздами
            if meta.get("sp"):
                d["sp"] = meta["sp"]                # успешная оплата
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
        if u.get("bot"):
            d["bot"] = 1
        if vt in ("major", "official", "blue"):
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


def add_message(sender, receiver, text, cid=None, kind="text", ents=None, att=None, reply_to=None, fw=None, auto=False, call=None, paid=0, extra=None):
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
                   meta_dump({"e": ents, "a": att, "fw": fw, "auto": 1 if auto else None, "c": call, "pd": paid or None, **(extra or {})}), reply_to,
                   (att or {}).get("fid"), (att or {}).get("tfid"), ts + ttl if ttl else 0)).lastrowid
        if sender == receiver:                     # «Избранное»: заметки себе всегда прочитаны
            run("UPDATE messages SET is_read=1 WHERE id=?", (mid,))
        row = q1("SELECT * FROM messages WHERE id=?", (mid,))
    mine = ser_one(row, sender)
    if receiver != sender:
        push(receiver, {"type": "message", "message": ser_one(row, receiver)})
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
        if user.get("banned"):
            return jsonify(ok=False, banned=True, error="Ваш аккаунт был заблокирован администрацией Dicegram"), 403
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
        if user.get("banned"):
            return jsonify(ok=False, banned=True, error="Ваш аккаунт был заблокирован администрацией Dicegram"), 403
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
RESERVED = {"telegram", "admin", "support", "botfather", "service", "official", "dicegram", "dicebot", "addemoji", "joinchat", "settings", "login", "static", "bot", "file"}


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
    bio_ents = u.get("bio_ents")
    if "bio" in d:
        raw = str(d["bio"])
        bio = raw.strip()[:140 if is_premium(u) else 70]   # с Premium «О себе» длиннее
        bio_ents = None
        if bio and raw.startswith(bio[:1]) and is_premium(u):
            # только свои эмодзи (ce); проверяются так же, как в сообщениях: набор свой или добавленный
            be = [e for e in clean_ents(d.get("bio_ents"), utf16len(bio), u) if e.get("t") == "ce"][:40]
            bio_ents = json.dumps(be, separators=(",", ":")) if be else None
    if "username" in d:
        username = str(d["username"]).strip().lstrip("@")
        if username and username != u["username"]:
            e = check_username(username, u["id"])
            if e:
                return err(e)
    try:
        run("UPDATE users SET name=?, surname=?, username=?, bio=?, bio_ents=?, birthday=?, birthday_vis=? WHERE id=?",
            (name, surname, username, bio, bio_ents, birthday, bvis, u["id"]))
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
    if not u.get("bot"):
        out["rating"] = rating_of(u)                  # у ботов рейтинга нет
    if not out.get("deleted"):
        out["unames"] = unames_of(uid)
    if u["username"]:
        out["plink"] = link_url(u["username"], "u")
    out["gifts_n"] = q1("SELECT COUNT(*) n FROM gifts WHERE to_id=? AND shown=1", (uid,))["n"]
    pc = pchan_out(u, viewer["id"])
    if pc:
        out["pchan"] = pc
    if not me_ and not u["is_system"]:
        out["in_contacts"] = bool(q1("SELECT 1 FROM saved_contacts WHERE owner=? AND contact=?", (viewer["id"], uid)))       # НЕ "saved": так помечено «Избранное»
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
    """{key: phone|seen|photo|fwd|calls|bio|voice|msg|gifts|invite|birthday, value: all|contacts|none}
    Особые: msg — all|cp|paid (+ price: 1…35000 звёзд за сообщение); gtypes — список принимаемых типов подарков."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    d = body()
    key, val = d.get("key"), d.get("value")
    if key == "gtypes":
        if not isinstance(val, list) or any(x not in GIFT_TYPES for x in val):
            return err("Неверная настройка")
        p = json_load(u.get("priv"), {})
        p["gtypes"] = [x for x in GIFT_TYPES if x in val]
        run("UPDATE users SET priv=? WHERE id=?", (json.dumps(p), u["id"]))
    else:
        if key not in PRIV_KEYS + ("birthday",) or val not in PRIV_VALUES_BY.get(key, PRIV_VALUES):
            return err("Неверная настройка")
        if key == "birthday":
            run("UPDATE users SET birthday_vis=? WHERE id=?", (val, u["id"]))
        else:
            p = json_load(u.get("priv"), {})
            if key == "msg" and val == "paid":
                price = num(d.get("price"), 1, MSG_PRICE_MAX)
                if price is None:
                    return err("Укажите цену одного сообщения: от 1 до 35 000 звёзд")
                p["msg_price"] = price
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
        if k == "tz" and v is not None:                    # время аккаунта: "adj:<минуты сдвига от телефона>" или "abs:<минуты от UTC>"
            m_ = re.fullmatch(r"(adj|abs):(-?\d{1,4})", str(v))
            if not m_ or abs(int(m_.group(2))) > 14 * 60:
                return err("Неверный часовой пояс")
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
            pe = public(p, viewer=me_, contact=True)
            if r["peer"] == me_:
                pe["saved"] = 1                    # «Избранное» — переписка с самим собой
            out.append({"peer": pe, "last": last, "unread": 0 if r["peer"] == me_ else unread.get(r["peer"], 0)})
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
    saved = {r["contact"] for r in qa("SELECT contact FROM saved_contacts WHERE owner=?", (u["id"],))}
    ids = sorted(({i for i in contacts(u["id"])} | saved) - {u["id"]})       # переписка + сохранённые по номеру (даже без единого сообщения)
    out = []
    if ids:
        for r in qa(f"SELECT * FROM users WHERE id IN ({','.join('?' * len(ids))}) AND is_system=0", ids):
            if r.get("deleted") or r.get("banned") or (r.get("bot") and r["id"] not in saved):
                continue
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
    if to == u["id"] and not u.get("bot"):                       # «Избранное»: заметки, файлы и подарки самому себе
        try:
            kind, text, ents, att, reply_to = parse_payload(u, d, to)
        except ValueError as e:
            return err(str(e))
        if not hit("send", u["id"], 30, 10):
            return err("Слишком часто. Подождите пару секунд", 429)
        return jsonify(ok=True, message=add_message(u["id"], to, text, cid, kind, ents, att, reply_to))
    peer = q1("SELECT id, banned, deleted, bot FROM users WHERE id=?", (to,))
    if not peer or to == u["id"]:
        return err("Нельзя отправить")
    if u.get("bot"):
        return err("Нельзя отправить", 403)
    if peer.get("banned") or peer.get("deleted"):
        return err("Этот аккаунт удалён", 403)
    be = block_err(u["id"], to)
    if be:
        return err(be, 403)
    try:
        kind, text, ents, att, reply_to = parse_payload(u, d, to)
    except ValueError as e:
        return err(str(e))
    if not hit("send", u["id"], 20, 10):
        return err("Слишком часто. Подождите пару секунд", 429)
    rcv = q1("SELECT * FROM users WHERE id=?", (to,))
    paid = 0
    if not (cid and q1("SELECT 1 FROM messages WHERE sender=? AND cid=?", (u["id"], cid))):     # повтор того же сообщения не списывает звёзды второй раз
        if kind == "voice" and not priv_ok(rcv, "voice", u["id"]):
            return err("Этот пользователь не принимает голосовые сообщения", 403)
        gate = msg_gate(u, rcv)
        if gate and gate[0] == "err":
            return err(gate[1], 403)
        if gate and gate[0] == "pay":
            price = gate[1]
            if num(d.get("paid"), 0, MSG_PRICE_MAX) != price:
                return jsonify(ok=False, error=f"Сообщение этому пользователю стоит {price} ⭐", need_pay=price), 402
            with db_lock:
                cur = run("UPDATE users SET stars=stars-? WHERE id=? AND stars>=?", (price, u["id"], price))
                if not cur.rowcount:
                    return jsonify(ok=False, error=f"Недостаточно звёзд: нужно {price}", need_pay=price, short=True), 402
                run("UPDATE users SET stars=stars+? WHERE id=?", (price, to))
            star_tx(u["id"], -price, "Платное сообщение", "paid_msg")
            star_tx(to, price, "Платное сообщение от " + (u.get("name") or "пользователя"), "paid_msg")
            paid = price
    msg = add_message(u["id"], to, text, cid, kind, ents, att, reply_to, paid=paid)
    if paid:
        notify_profile(to)
        notify_profile(u["id"])
    if peer.get("bot"):
        try:
            bot_incoming(u, to, msg["id"])
        except Exception as e:
            print("bot_incoming:", repr(e))
    if to == support_id():
        try:
            what = text or MSG_KIND_TXT.get(kind, kind)
            mid_ = hc_post("reports", f"💬 Сообщение в {SUPPORT_NAME}\n👤 От: {who_label(u)}\n\n{what[:1500]}",
                           kb=[[{"t": "💬 Ответить", "d": f"dm:{u['id']}"}, {"t": "🔎 Инфо", "d": f"rep_u:{u['id']}"}],
                               [{"t": "👤 Открыть профиль", "o": f"user:{u['id']}"}]])
        except Exception as e:
            print("support → admin-panel:", e)
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
            both = everyone or r["sender"] == r["receiver"] or bool(r.get("del_r" if col == "del_s" else "del_s"))
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
    if to and to > 0:
        rc_ = q1("SELECT * FROM users WHERE id=?", (to,))
        g_ = msg_gate(u, rc_)
        if g_:
            return err(g_[1] if g_[0] == "err" else f"Этот пользователь принимает сообщения за {g_[1]} ⭐ — напишите ему обычным сообщением", 403)
    ids = sorted({n for n in (num(x, 1, 2 ** 62) for x in (d.get("ids") or [])[:20]) if n}) if isinstance(d.get("ids"), list) else []
    sent = []
    for mid in ids:
        r = mine_row(mid, uid)
        if not r:
            continue
        if r["receiver"] < 0 and is_hc(-r["receiver"]):
            return err("Сообщения admin-panel пересылать нельзя", 403)
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
    lim = MAX_UPLOAD_PREMIUM if is_premium(u) else MAX_UPLOAD
    if size > lim:
        if lim < MAX_UPLOAD_PREMIUM and size <= MAX_UPLOAD_PREMIUM:
            return jsonify(ok=False, error=f"Файл больше {lim // 1048576} МБ. С Premium можно загружать файлы до {MAX_UPLOAD_PREMIUM // 1048576} МБ",
                           premium=True, max=lim, max_premium=MAX_UPLOAD_PREMIUM), 400
        return err(f"Файл слишком большой (максимум {lim // 1048576} МБ)")
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


# ───────────────────── ГОЛОС В ТЕКСТ (Premium, личный результат) ─────────────────────
STT_EXT = {"audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/aac": "m4a", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav",
           "audio/x-wav": "wav", "audio/x-m4a": "m4a", "audio/flac": "flac", "video/webm": "webm", "video/mp4": "mp4"}
stt_busy = set()


@app.post("/api/voice/transcribe")
def voice_transcribe():
    """{mid} — расшифровать голосовое сообщение в текст. Только для Premium. Результат личный: хранится у того, кто нажал,
    не отправляется собеседнику, не попадает в сообщение и не рассылается по WebSocket. Повторное нажатие берёт готовый текст."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    mid = num(body().get("mid"), 1, 2 ** 62) or 0
    m = q1("SELECT * FROM messages WHERE id=?", (mid,))
    if not m or m.get("kind") != "voice" or not m.get("fid") or not can_access(u["id"], m["fid"]):
        return err("Сообщение не найдено", 404)
    if not is_premium(u):
        return jsonify(ok=False, error="Расшифровка голосовых доступна с Premium", premium=True), 403
    row = q1("SELECT text FROM voice_stt WHERE uid=? AND mid=?", (u["id"], mid))
    if row:
        return jsonify(ok=True, text=decrypt_text(row["text"]), cached=True)
    if not STT_URL:
        return jsonify(ok=False, error="Распознавание речи на сервере пока не подключено", unconfigured=True), 503
    f = q1("SELECT * FROM files WHERE fid=? AND done=1", (m["fid"],))
    if not f or not os.path.exists(file_path(f["fid"])):
        return err("Файл не найден", 404)
    if f["size"] > STT_MAX:
        return err("Это голосовое слишком длинное для расшифровки")
    if not hit("stt", u["id"], 20, 60):
        return err("Слишком часто. Попробуйте через минуту", 429)
    key = (u["id"], mid)
    if key in stt_busy:
        return err("Уже расшифровывается — подождите пару секунд", 409)
    stt_busy.add(key)
    try:
        with open(file_path(f["fid"]), "rb") as fh:
            data = fh.read()
        mime = (f["mime"] or "audio/webm").split(";")[0].strip().lower()
        fields = {"model": STT_MODEL, "response_format": "json"}
        if STT_LANG:
            fields["language"] = STT_LANG
        hdr = {"Authorization": "Bearer " + STT_API_KEY} if STT_API_KEY else {}
        try:
            r = requests.post(STT_URL, headers=hdr, data=fields, files={"file": ("voice." + STT_EXT.get(mime, "webm"), data, mime)}, timeout=STT_TIMEOUT)
        except requests.RequestException as e:
            print("stt request failed:", repr(e))
            return jsonify(ok=False, error="Сервис распознавания не отвечает. Попробуйте позже"), 502
        if r.status_code != 200:
            print("stt http", r.status_code, r.text[:200])
            return jsonify(ok=False, error="Не удалось распознать речь. Попробуйте позже"), 502
        try:
            text = str((r.json() or {}).get("text") or "").strip()
        except ValueError:
            text = ""
    finally:
        stt_busy.discard(key)
    if not text:
        return jsonify(ok=True, text="", empty=True)                 # речи нет — не запоминаем, можно повторить
    text = text[:4000]
    with db_lock:
        run("INSERT OR REPLACE INTO voice_stt(uid, mid, text, ts) VALUES(?,?,?,?)", (u["id"], mid, encrypt_text(text), int(time.time())))
    return jsonify(ok=True, text=text)


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


@app.post("/api/me/pbg")
def me_pbg():
    """Фон профиля: один из премиальных (Premium) или "" — без фона."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    v = str(body().get("id") or "")
    if v and v not in PBG_IDS:
        return err("Неизвестный фон")
    if v and not is_premium(u) and u.get("number") != ADMIN_NUMBER:
        return jsonify(ok=False, error="Фоны профиля доступны с Premium", need_premium=True), 403
    run("UPDATE users SET pbg=? WHERE id=?", (v, u["id"]))
    notify_profile(u["id"])
    return jsonify(ok=True, user=public(fresh(u["id"]), True))


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
        rows = qa("SELECT * FROM users WHERE number=? AND is_system=0 AND COALESCE(banned,0)=0 AND COALESCE(deleted,0)=0 AND id!=?", ("+" + digits, u["id"]))
    else:
        ql = q.lower()
        like = "%" + ql.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        found = qa("""SELECT * FROM users WHERE is_system=0 AND COALESCE(banned,0)=0 AND COALESCE(deleted,0)=0 AND id!=?
                      AND (plower(username) LIKE ? ESCAPE '\\' OR plower(name) LIKE ? ESCAPE '\\'
                           OR plower(surname) LIKE ? ESCAPE '\\' OR plower(name || ' ' || surname) LIKE ? ESCAPE '\\'
                           OR id IN (SELECT uid FROM unames WHERE plower(name) LIKE ? ESCAPE '\\'))
                      LIMIT 100""", (u["id"], like, like, like, like, like))
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
        if max(now, cur.get("premium_until") or 0) + PREMIUM_DAYS[plan] * 86400 > now + 5 * 365 * 86400:      # продлевать можно, но не дальше 5 лет вперёд
            return jsonify(ok=False, error="Premium уже оплачен на несколько лет вперёд. Продлить можно позже", active=True), 409
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
        ton = fnum(d.get("ton"), 0.01, 10 ** 9) or random_ton_price(uname)
        res = grant_uname(t, uname, ton, u, fnum(d.get("usd"), 0.01, 10 ** 9))
        if not res.startswith("✅"):
            return err(res)
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


# ───────────────────── РЕЖИМ ТЕХРАБОТ ─────────────────────
# Один тумблер в админ-панели (тема «Техработы»): обычные пользователи не могут войти и видят экран с причиной и
# примерным временем окончания. Номера из белого списка (по умолчанию — владелец +88888888888) работают как обычно.
MAINT_ALWAYS = list(dict.fromkeys([ADMIN_NUMBER, "+88888888888"]))
_maint_cache = {"ts": 0.0, "v": None}


def maint_get(force=False):
    now = time.time()
    if not force and _maint_cache["v"] is not None and now - _maint_cache["ts"] < 3:
        return _maint_cache["v"]
    v = kv_get("maint") or {}
    wl = [n for n in (v.get("wl") or []) if isinstance(n, str) and re.fullmatch(r"\+888\d{8}", n)]
    st = {"on": bool(v.get("on")), "reason": str(v.get("reason") or "")[:500], "until": int(v.get("until") or 0), "since": int(v.get("since") or 0),
          "wl": list(dict.fromkeys(MAINT_ALWAYS + wl))[:300]}
    _maint_cache["ts"], _maint_cache["v"] = now, st
    return st


def maint_set(**kw):
    cur = dict(maint_get(True))
    cur.update(kw)
    kv_set("maint", {k: cur[k] for k in ("on", "reason", "until", "since", "wl")})
    _maint_cache["v"] = None
    return maint_get(True)


def maint_pub(st=None):
    st = st or maint_get()
    return {"on": st["on"], "reason": st["reason"], "until": st["until"], "now": int(time.time())}


def maint_resp(st):
    return jsonify(ok=False, maintenance=True, error="Технические работы", reason=st["reason"], until=st["until"], now=int(time.time())), 503


@app.get("/api/maintenance")
def maintenance_status():
    """Публичный статус техработ (без входа): экран «Технические работы» опрашивает его и сам закрывается, когда работы закончены."""
    return jsonify(ok=True, **maint_pub())


@app.before_request
def maint_gate():
    st = maint_get()
    if not st["on"]:
        return None
    p = request.path
    if not p.startswith("/api/") or p in ("/api/maintenance", "/api/auth/password", "/api/auth/logout"):
        return None
    if p in ("/api/auth/request", "/api/auth/verify"):
        return None if norm(body().get("number")) in st["wl"] else maint_resp(st)
    u = auth_user()
    return None if u and u.get("number") in st["wl"] else maint_resp(st)


def maint_kick():
    """Режим включили: у обычных пользователей, которые сейчас онлайн, открывается экран техработ."""
    st = maint_get(True)
    ids = list(clients.keys())
    if not ids:
        return
    for r in qa(f"SELECT id, number FROM users WHERE id IN ({','.join('?' * len(ids))})", ids):
        if r["number"] in st["wl"]:
            continue
        push(r["id"], {"type": "maint", **maint_pub(st)})


def maint_parse_until(text, now=None):
    """«2ч», «90м», «1д 3ч», «18:30» (сегодня/завтра), «15.11 18:00», «-» (убрать). Время — по UTC+STATS_TZ. → (ts | 0 | None)."""
    t = str(text or "").strip().lower()
    now = int(now or time.time())
    if t in ("-", "нет", "0", "сброс", "убрать"):
        return 0
    m = re.fullmatch(r"(?:(\d+)\s*д)?\s*(?:(\d+)\s*(?:ч|час\w*|h))?\s*(?:(\d+)\s*(?:м|мин\w*|m))?", t)
    if m and any(m.groups()):
        sec = int(m.group(1) or 0) * 86400 + int(m.group(2) or 0) * 3600 + int(m.group(3) or 0) * 60
        return now + sec if 0 < sec <= 60 * 86400 else None
    off = timedelta(hours=STATS_TZ)
    loc = datetime.fromtimestamp(now, tz=timezone.utc) + off
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", t)
    if m:
        h, mi = int(m.group(1)), int(m.group(2))
        if h > 23 or mi > 59:
            return None
        d = loc.replace(hour=h, minute=mi, second=0, microsecond=0)
        if d <= loc:
            d += timedelta(days=1)
        return int((d - off).timestamp())
    m = re.fullmatch(r"(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?\s+(\d{1,2}):(\d{2})", t)
    if m:
        try:
            y = int(m.group(3)) if m.group(3) else loc.year
            y += 2000 if y < 100 else 0
            d = datetime(y, int(m.group(2)), int(m.group(1)), int(m.group(4)), int(m.group(5)), tzinfo=timezone.utc)
        except ValueError:
            return None
        ts = int((d - off).timestamp())
        return ts if ts > now else None
    return None


def maint_fmt(ts):
    try:
        return (datetime.fromtimestamp(int(ts), tz=timezone.utc) + timedelta(hours=STATS_TZ)).strftime("%d.%m.%Y %H:%M") + f" (UTC{STATS_TZ:+d})"
    except Exception:
        return "—"


def maint_card():
    st = maint_get(True)
    wl = st["wl"]
    txt = (f"🛠 Режим техработ: {'🔴 ВКЛЮЧЁН' if st['on'] else '🟢 выключен'}\n\n"
           f"📝 Причина: {st['reason'] or '— не задана (пользователи увидят «Идут технические работы»)'}\n"
           f"🕐 Примерное окончание: {maint_fmt(st['until']) if st['until'] else 'не указано'}\n"
           f"✅ Белый список ({len(wl)}): {', '.join(wl)}\n\n"
           "Пока режим включён, обычные пользователи не могут войти и видят экран с причиной и временем окончания. "
           "Номера из белого списка заходят как обычно (владелец +88888888888 — всегда).")
    kb = [[{"t": "🟢 Выключить" if st["on"] else "🔴 Включить", "d": "mt:tg"}],
          [{"t": "📝 Причина", "d": "mt:r"}, {"t": "🕐 Время окончания", "d": "mt:e"}],
          [{"t": "➕ Номер в белый список", "d": "mt:a"}]]
    rm = [n for n in wl if n not in MAINT_ALWAYS][:20]
    for i in range(0, len(rm), 2):
        kb.append([{"t": "✖ " + n, "d": "mt:d:" + n} for n in rm[i:i + 2]])
    return txt, kb


def maint_action(u, row, p):
    """Кнопки карточки «Техработы»: mt:tg | mt:r | mt:e | mt:a | mt:d:<номер>."""
    mid, topic = row["id"], row.get("topic") or 0
    a = p[1] if len(p) > 1 else ""
    if a == "tg":
        st = maint_get(True)
        on = not st["on"]
        maint_set(on=on, since=int(time.time()) if on else 0)
        hc_log(f"🛠 {who_label(u)}: режим техработ {'ВКЛЮЧЁН' if on else 'выключен'}")
        if on:
            maint_kick()
        hc_edit(mid, *maint_card())
        return "Режим техработ включён" if on else "Режим техработ выключен"
    if a == "d" and len(p) > 2:
        st = maint_get(True)
        n = p[2]
        if n in MAINT_ALWAYS:
            return "Этот номер нельзя убрать"
        v = kv_get("maint") or {}
        maint_set(wl=[x for x in (v.get("wl") or []) if x != n])
        hc_log(f"🛠 {who_label(u)}: номер {n} убран из белого списка техработ")
        hc_edit(mid, *maint_card())
        return "Убрано"
    prompts = {"r": ("mt_reason", "📝 Напишите причину — её увидят пользователи. «-» — убрать причину."),
               "e": ("mt_end", "🕐 Когда примерно закончатся работы? Напишите, например: 2ч, 90м, 1д 3ч, 18:30 или 15.11 18:00 "
                               f"(время по UTC{STATS_TZ:+d}). «-» — не указывать время."),
               "a": ("mt_add", "➕ Напишите номер, который сможет заходить во время техработ: +888 и ровно 8 цифр, например +88812345678.")}
    if a in prompts:
        k, text = prompts[a]
        hc_wait[u["id"]] = {"k": k, "t": 0, "topic": topic, "ts": time.time(), "mid": mid}
        hc_edit(mid, text, [[{"t": "❌ Отмена", "d": "mt:x"}]])
        return ""
    if a == "x":
        hc_wait.pop(u["id"], None)
        hc_edit(mid, *maint_card())
        return ""
    return ""


def maint_input(u, topic, w, text):
    """Ответ админа на вопрос карточки «Техработы» (причина / время / номер). Всегда True — сообщение было ответом."""
    k, mid = w["k"], w.get("mid")
    text = (text or "").strip()
    if k == "mt_reason":
        maint_set(reason="" if text == "-" else text[:500])
        hc_log(f"🛠 {who_label(u)}: причина техработ изменена")
    elif k == "mt_end":
        ts = maint_parse_until(text)
        if ts is None:
            hc_wait[u["id"]] = dict(w, ts=time.time())
            hc_reply(topic, "Не понял время. Примеры: 2ч, 90м, 1д 3ч, 18:30, 15.11 18:00. «-» — убрать. Напишите ещё раз.")
            return True
        maint_set(until=ts)
        hc_log(f"🛠 {who_label(u)}: окончание техработ — {maint_fmt(ts) if ts else 'не указано'}")
    elif k == "mt_add":
        n = parse_new_number(text)
        if not n:
            hc_wait[u["id"]] = dict(w, ts=time.time())
            hc_reply(topic, "Номер должен быть строго +888 и ровно 8 цифр, например +88812345678. Напишите ещё раз.")
            return True
        v = kv_get("maint") or {}
        maint_set(wl=list(dict.fromkeys((v.get("wl") or []) + [n]))[:300])
        hc_log(f"🛠 {who_label(u)}: номер {n} добавлен в белый список техработ")
    st = maint_get(True)
    if mid and q1("SELECT 1 FROM messages WHERE id=?", (mid,)):
        hc_edit(mid, *maint_card())
    else:
        hc_reply(topic, *maint_card())
    if st["on"]:
        maint_kick()
    return True


# ───────────────────── АДМИН-ПАНЕЛЬ (служебная группа «admin-panel») ─────────────────────
# Закрытая группа с темами. Вступить в неё нельзя ни по ссылке, ни по адресу — участников добавляет только
# владелец сервиса. Любой участник может пользоваться командами и кнопками. Бот (официальный аккаунт)
# отвечает прямо в темах: карточки аккаунтов с кнопками (бан, очистка, удаление, связь), выдача по кнопкам,
# верификация, жалобы с перепиской-доказательством, ежедневная и еженедельная статистика.
# Коды входа и облачные пароли сюда не попадают никогда.
HC_TITLE = "admin-panel"
HC_ABOUT = "Закрытая служебная группа администрации Dicegram. Вступить нельзя — участников добавляет только владелец."
HC_TOPICS = (("logs", "Логи", "📋"), ("new", "Новые аккаунты", "🆕"), ("info", "Инфо об аккаунте", "🔎"),
             ("grant", "Выдача", "🎁"), ("verify", "Верификация", "✅"), ("reports", "Жалобы и репорты", "🚨"),
             ("stats", "Статистика", "📊"), ("numbers", "Номера", "📞"), ("maint", "Техработы", "🛠"))
SUPPORT_NUMBER, SUPPORT_NAME = "+42778", "Dicegram Support"
STATS_TZ = int(os.environ.get("STATS_TZ", "5"))        # часовой пояс отчётов статистики (часы от UTC), по умолчанию UTC+5
HC_WAIT_TTL = 600
_hc_cache = {}
hc_wait = {}                                              # uid → ожидаемый ввод: {"k", "t", "topic", "ts", ...}


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


def support_id():
    """Официальный аккаунт «Dicegram Support»: от его имени администрация пишет людям в личку."""
    r = q1("SELECT id FROM users WHERE number=?", (SUPPORT_NUMBER,))
    if r:
        return r["id"]
    with db_lock:
        r = q1("SELECT id FROM users WHERE number=?", (SUPPORT_NUMBER,))
        if r:
            return r["id"]
        return run("INSERT INTO users(number,name,is_system,created) VALUES(?,?,1,?)",
                   (SUPPORT_NUMBER, SUPPORT_NAME, int(time.time()))).lastrowid


def system_ids():
    return {r["id"] for r in qa("SELECT id FROM users WHERE is_system=1")}


def ensure_helpcreator():
    """Возвращает (chat_row, {key: topic_id}); создаёт группу и темы при первой необходимости и
    один раз за запуск приводит её к нужному виду: название, закрытость (без ссылок и адреса), темы."""
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
                      (HC_TITLE, HC_ABOUT, admin["id"], now)).lastrowid
            run("INSERT INTO chat_members(chat_id,user_id,role,joined,adder) VALUES(?,?,'owner',?,0)", (cid, admin["id"], now))
            ch = chat_row(cid)
            saved = {"chat": cid, "topics": {}}
        topics = saved.get("topics") or {}
        changed = not saved.get("chat")
        for key, title, emoji in HC_TOPICS:
            if not topics.get(key) or not q1("SELECT 1 FROM chat_topics WHERE id=? AND chat_id=?", (topics[key], ch["id"])):
                tid = run("INSERT INTO chat_topics(chat_id,title,color,emoji,creator,ts) VALUES(?,?,0,?,?,?)",
                          (ch["id"], title, emoji, admin["id"], int(time.time()))).lastrowid
                topics[key] = tid
                changed = True
            else:
                run("UPDATE chat_topics SET title=?, emoji=? WHERE id=? AND (title!=? OR emoji!=?)", (title, emoji, topics[key], title, emoji))
        if changed:
            kv_set("hc", {"chat": ch["id"], "topics": topics})
        # закрытость: никаких пригласительных ссылок и публичного адреса; название — admin-panel
        run("UPDATE chat_links SET revoked=1 WHERE chat_id=? AND revoked=0", (ch["id"],))
        run("UPDATE chats SET slug='', title=?, about=?, topics=1 WHERE id=? AND (slug!='' OR title!=? OR topics=0)",
            (HC_TITLE, HC_ABOUT, ch["id"], HC_TITLE))
        ch = chat_row(ch["id"])
    _hc_cache["chat"], _hc_cache["topics"] = ch["id"], topics
    return ch, topics


def hc_id():
    ch, _ = ensure_helpcreator()
    return ch["id"] if ch else 0


def is_hc(cid):
    return bool(cid) and cid == (_hc_cache.get("chat") or hc_id())


def hc_member(uid):
    cid = hc_id()
    return bool(cid and member_row(cid, uid))


def hc_post(topic_key, text, kb=None, ents=None):
    """Сообщение бота в тему админ-панели. Возвращает id сообщения (или 0)."""
    try:
        ch, topics = ensure_helpcreator()
        if not ch:
            return 0
        tid = topics.get(topic_key)
        if tid:
            return (add_gmessage(ch, SYSTEM_ID, text, ents=ents, topic=tid, kb=kb) or {}).get("id") or 0
    except Exception as e:
        print("hc_post error:", e)
    return 0


def hc_reply(topic_id, text, kb=None):
    ch, _ = ensure_helpcreator()
    if ch:
        return (add_gmessage(ch, SYSTEM_ID, text, topic=topic_id, kb=kb) or {}).get("id") or 0
    return 0


def hc_edit(mid, text=None, kb=None):
    """Изменить сообщение бота в админ-панели (текст и/или кнопки) у всех участников."""
    row = q1("SELECT * FROM messages WHERE id=?", (mid,))
    if not row or row["receiver"] >= 0:
        return
    meta = meta_load(row["meta"])
    if kb is not None:
        meta["kb"] = kb or None
    if text is not None:
        meta["e"] = None
    run("UPDATE messages SET text=?, meta=? WHERE id=?", (encrypt_text(text) if text is not None else row["text"], meta_dump(meta), mid))
    row = q1("SELECT * FROM messages WHERE id=?", (mid,))
    for v in member_ids(-row["receiver"]):
        if clients.get(v):
            push(v, {"type": "edit", "message": ser_one(row, v)})


def hc_log(text):
    hc_post("logs", text)


def who_label(u):
    if not u:
        return "—"
    n = " ".join(x for x in (u.get("name"), u.get("surname")) if x) or "Пользователь"
    return f"{n} ({u['number']})" if u.get("number") and not str(u["number"]).startswith("deleted:") else n


def hc_resolve(token):
    """номер телефона / @имя / #id чата / ID пользователя → ('user', row) | ('chat', row) | None."""
    token = (token or "").strip()
    if not token:
        return None
    if token[0] == "#":
        cid = num(token[1:], 1, 2 ** 62)
        ch = q1("SELECT * FROM chats WHERE id=?", (cid,)) if cid else None
        return ("chat", ch) if ch else None
    if token[0] == "@":
        name = token[1:]
        t = user_by_name(name)
        if t:
            return ("user", t)
        ch = q1("SELECT * FROM chats WHERE slug=? COLLATE NOCASE", (name,))
        return ("chat", ch) if ch else None
    t = q1("SELECT * FROM users WHERE number=?", (norm(token),))
    if t:
        return ("user", t)
    if token.isdigit() and len(token) <= 12:
        t = q1("SELECT * FROM users WHERE id=?", (int(token),))
        if t:
            return ("user", t)
    if re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{3,31}", token):      # юзернейм без «@» (бот, человек, группа или канал)
        t = user_by_name(token)
        if t:
            return ("user", t)
        ch = q1("SELECT * FROM chats WHERE slug=? COLLATE NOCASE", (token,))
        if ch:
            return ("chat", ch)
    return None


def hc_fmt_ts(ts):
    try:
        return datetime.fromtimestamp(int(ts), tz=timezone.utc).strftime("%d.%m.%Y %H:%M UTC")
    except Exception:
        return "—"


def ru_plural(n, a, b, c):
    n = abs(int(n))
    if n % 10 == 1 and n % 100 != 11:
        return a
    return b if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14 else c


def ago_ru(ts):
    secs = max(0, time.time() - (ts or 0))
    if secs < 3600:
        m_ = int(secs // 60)
        return "только что" if m_ < 1 else f"{m_} {ru_plural(m_, 'минуту', 'минуты', 'минут')} назад"
    if secs < 86400:
        h_ = int(secs // 3600)
        return f"{h_} {ru_plural(h_, 'час', 'часа', 'часов')} назад"
    d_ = int(secs // 86400)
    if d_ < 30:
        return f"{d_} {ru_plural(d_, 'день', 'дня', 'дней')} назад"
    mo = d_ // 30
    if mo < 12:
        return f"{mo} {ru_plural(mo, 'месяц', 'месяца', 'месяцев')} назад"
    y = d_ // 365
    return f"{y} {ru_plural(y, 'год', 'года', 'лет')} назад"


# ── карточка аккаунта ──
def hc_card(t):
    """Инфо об аккаунте для админ-панели (без кодов входа и паролей) + кнопки управления."""
    name = " ".join(x for x in (t.get("name"), t.get("surname")) if x) or "—"
    if t.get("deleted"):
        return f"⚫️ Аккаунт удалён\n🆔 ID: {t['id']}", [[{"t": "Аккаунт удалён", "d": "noop"}]]
    if t.get("banned"):
        st = "🔴 Заблокирован"
    elif clients.get(t["id"]):
        st = "🟢 В сети"
    else:
        st = "⚪️ Был(а) " + (ago_ru(t["last_seen"]) if t.get("last_seen") else "давно")
    ips = {r["ip"] for r in qa("SELECT ip FROM sessions WHERE user_id=?", (t["id"],)) if r["ip"]}
    ipch = "Нет" if len(ips) <= 1 else f"Да ({len(ips)} {ru_plural(len(ips), 'адрес', 'адреса', 'адресов')})"
    reps = (q1("SELECT COUNT(*) n FROM reports WHERE kind='user' AND target=?", (t["id"],)) or {}).get("n", 0)
    vt = {"major": "🔷 Major", "official": "⚫️ Official", "blue": "✅ Синяя галочка"}.get(t.get("vtier") or "", "нет")
    lines = [
        f"👤 Пользователь: {name}" + (f" (@{t['username']})" if t.get("username") else ""),
        f"🆔 ID: {t['id']} | Номер: {t['number']}",
        f"🗓 Регистрация: {datetime.fromtimestamp(t.get('created') or 0, tz=timezone.utc).strftime('%d.%m.%Y')} ({ago_ru(t.get('created') or 0)})",
        f"📶 Статус: {st} | Смена IP: {ipch}",
        f"🚩 Репорты от других юзеров: {reps}",
        f"⛔️ Текущий статус блока: {'🔴 Заблокирован ' + hc_fmt_ts(t.get('banned_at')) if t.get('banned') else '🟢 Не заблокирован'}",
        f"🔐 Облачный пароль: {'установлен' if t.get('cloud_hash') else 'не установлен'}",
        f"⭐ Звёзды: {t.get('stars') or 0} · 💎 Premium: {'до ' + hc_fmt_ts(t['premium_until']) if is_premium(t) else 'нет'}",
        f"✅ Верификация: {vt}",
    ]
    un_ = qa("SELECT name, ton FROM unames WHERE uid=? ORDER BY id", (t["id"],))
    if un_:
        lines.append("🏷 Коллекционные имена: " + ", ".join(f"@{r['name']} ({fmt_ton(r['ton'])} TON)" for r in un_))
    sess = qa("SELECT device, ip, country, last_used FROM sessions WHERE user_id=? ORDER BY last_used DESC LIMIT 5", (t["id"],))
    lines.append("—— Сеансы ——" if sess else "Активных сеансов нет.")
    for s in sess:
        lines.append(f"{s['device'] or '?'} · {s['ip'] or '?'} · {s['country'] or '?'} · {hc_fmt_ts(s['last_used'])}")
    return "\n".join(lines), hc_card_kb(t)


def hc_card_kb(t):
    uid = t["id"]
    if t.get("is_system"):
        return [[{"t": "👤 Открыть профиль", "o": f"user:{uid}"}]]
    ban = {"t": "🟢 Разблокировать", "d": f"unban:{uid}"} if t.get("banned") else {"t": "⛔️ Заблокировать (Бан)", "d": f"ban:{uid}"}
    return [[ban],
            [{"t": "🧹 Очистить сообщения", "d": f"clear:{uid}"}, {"t": "🗑 Удалить аккаунт", "d": f"del:{uid}"}],
            [{"t": "💬 Связаться", "d": f"dm:{uid}"}, {"t": "🎁 Выдать", "d": f"g:{uid}"}],
            [{"t": "👤 Открыть профиль", "o": f"user:{uid}"}]]


NUM_FULL_RE = re.compile(r"^\+?888(\d{8})$")


def parse_new_number(text):
    """Новый номер: строго +888 и ровно 8 цифр (пробелы, дефисы и скобки не мешают, «+» можно не писать).
    Возвращает '+888XXXXXXXX' или None."""
    t = re.sub(r"[\s\-()]", "", str(text or ""))
    m = NUM_FULL_RE.match(t)
    return "+888" + m.group(1) if m else None


def hc_number_card(t):
    """Карточка «Номера»: кто это, текущий номер и кнопка «Изменить номер»."""
    if t.get("deleted"):
        return "⚫️ Аккаунт удалён.", None
    name = " ".join(x for x in (t.get("name"), t.get("surname")) if x) or "—"
    lines = [f"📞 {name}" + (f" (@{t['username']})" if t.get("username") else ""), f"🆔 ID: {t['id']}", f"📱 Текущий номер: {t['number']}"]
    if t.get("is_system") or t["number"] == ADMIN_NUMBER:
        lines.append("🔒 У служебных аккаунтов и владельца номер менять нельзя.")
        return "\n".join(lines), None
    return "\n".join(lines), [[{"t": "✏️ Изменить номер", "d": f"nm:{t['id']}"}]]


def hc_cmd_numbers(text):
    text = (text or "").strip()
    if not text:
        return "Напишите номер или @username аккаунта — покажу номер и кнопку «Изменить номер».", None
    r = hc_resolve(text)
    if not r or r[0] != "user":
        return "Пользователь не найден. Напишите номер (+888…), @username или ID.", None
    return hc_number_card(r[1])


def change_user_number(t, new, by):
    """Смена номера админом. Возвращает текст результата («✅ …» или причина отказа)."""
    t = fresh(t["id"])
    if not t or t.get("deleted"):
        return "❌ Аккаунт не найден или удалён."
    if t.get("is_system") or t["number"] == ADMIN_NUMBER:
        return "❌ У служебных аккаунтов и владельца номер менять нельзя."
    if new == t["number"]:
        return "❌ Это уже текущий номер аккаунта."
    if new == ADMIN_NUMBER:
        return "❌ Этот номер зарезервирован."
    with db_lock:
        if q1("SELECT 1 FROM users WHERE number=? AND id!=?", (new, t["id"])):
            return "❌ Номер уже занят другим аккаунтом."
        old = t["number"]
        run("UPDATE users SET number=? WHERE id=?", (new, t["id"]))
        run("DELETE FROM codes WHERE number=?", (new,))
        run("DELETE FROM locks WHERE number=?", (new,))
    notify_profile(t["id"])
    hc_log(f"📞 {who_label(by)}: номер {old} → {new} (ID {t['id']})")
    return f"✅ Номер изменён: {old} → {new}\nАккаунт: {who_label(fresh(t['id']))}"


def hc_cmd_info(text):
    r = hc_resolve(text)
    if not r or r[0] != "user":
        return "Аккаунт не найден. Укажите номер телефона, @username или ID.", None
    return hc_card(r[1])


# ── бан / разбан / очистка / удаление / связь ──
def kick_ws(uid, payload=None):
    for ws in list(clients.get(uid, [])):
        try:
            if payload:
                ws.send(json.dumps(payload))
            ws.close()
        except Exception:
            pass


def protected_acc(t):
    return bool(t.get("is_system")) or t.get("number") == ADMIN_NUMBER


def ban_user(t, by):
    if protected_acc(t):
        return "Этот аккаунт заблокировать нельзя"
    if t.get("deleted"):
        return "Аккаунт уже удалён"
    if t.get("banned"):
        return "Уже заблокирован"
    backup = {k: t.get(k) or "" for k in ("name", "surname", "username", "avatar", "bio", "estatus")}
    with db_lock:
        run("""UPDATE users SET banned=1, banned_at=?, ban_backup=?, name='Удалённый аккаунт', surname='', username='',
               avatar='', bio='', estatus='' WHERE id=?""", (int(time.time()), encrypt_text(json.dumps(backup, ensure_ascii=False)), t["id"]))
        run("DELETE FROM sessions WHERE user_id=?", (t["id"],))
        run("DELETE FROM fcm_tokens WHERE user_id=?", (t["id"],))
        run("DELETE FROM push_subs WHERE user_id=?", (t["id"],))
    kick_ws(t["id"], {"type": "banned"})                         # открытые приложения сразу выходят из аккаунта
    notify_profile(t["id"])
    hc_log(f"⛔️ {who_label(by)} заблокировал(а) {t['number']} (id {t['id']})")
    return None


def unban_user(t, by):
    if not t.get("banned"):
        return "Аккаунт не заблокирован"
    try:
        b = json.loads(decrypt_text(t["ban_backup"])) if t.get("ban_backup") else {}
    except Exception:
        b = {}
    uname = b.get("username") or ""
    if uname and name_taken(uname, skip_user=t["id"]):
        uname = ""                                                 # пока был в бане, имя занял кто-то другой
    run("""UPDATE users SET banned=0, banned_at=0, ban_backup='', name=?, surname=?, username=?, avatar=?, bio=?, estatus=?
           WHERE id=?""", (b.get("name") or "Пользователь", b.get("surname") or "", uname, b.get("avatar") or "",
                           b.get("bio") or "", b.get("estatus") or "", t["id"]))
    notify_profile(t["id"])
    hc_log(f"🟢 {who_label(by)} разблокировал(а) {t['number']} (id {t['id']})")
    return None


def clear_user_messages(t, by, log=True):
    """Удалить у всех ВСЁ, что человек отправил: сообщения, голосовые, файлы, стикеры, реакции и истории."""
    uid = t["id"]
    rows = qa("SELECT id, sender, receiver, fid, tfid FROM messages WHERE sender=?", (uid,))
    ids = [r["id"] for r in rows]
    fids = [f for r in rows for f in (r.get("fid"), r.get("tfid"))]
    with db_lock:
        for i in range(0, len(ids), 400):
            part = ids[i:i + 400]
            ph = ",".join("?" * len(part))
            run(f"DELETE FROM reacts WHERE msg_id IN ({ph})", part)
            run(f"DELETE FROM messages WHERE id IN ({ph})", part)
        run("DELETE FROM reacts WHERE user_id=?", (uid,))
        st = qa("SELECT fid, tfid FROM stories WHERE owner=?", (uid,))
        fids += [f for s in st for f in (s.get("fid"), s.get("tfid"))]
        run("DELETE FROM stories WHERE owner=?", (uid,))
    try:
        gc_files(fids)
    except Exception as e:
        print("clear gc:", e)
    by_user = {}
    for r in rows:
        aud = member_ids(-r["receiver"]) if r["receiver"] < 0 else (r["receiver"], r["sender"])
        for v in aud:
            by_user.setdefault(v, []).append(r["id"])
    for v, lst in by_user.items():
        if clients.get(v):
            for i in range(0, len(lst), 500):
                push(v, {"type": "del", "ids": lst[i:i + 500]})
    if log:
        hc_log(f"🧹 {who_label(by)} очистил(а) все сообщения {t['number']}: удалено {len(ids)}")
    return len(ids)


def delete_account(t, by):
    """Полное удаление (как GDPR): профиль стирается, номер освобождается для новой регистрации."""
    if protected_acc(t):
        return "Этот аккаунт удалить нельзя", 0
    if t.get("deleted"):
        return "Аккаунт уже удалён", 0
    uid, number = t["id"], t["number"]
    n = clear_user_messages(t, by, log=False)
    with db_lock:
        for tbl, col in (("sessions", "user_id"), ("fcm_tokens", "user_id"), ("push_subs", "user_id"),
                         ("game_wallet", "user_id"), ("game_scores", "user_id")):
            run(f"DELETE FROM {tbl} WHERE {col}=?", (uid,))
        run("DELETE FROM saved_contacts WHERE owner=? OR contact=?", (uid, uid))
        # свои группы/каналы — передаём самому старому администратору (или участнику); пустые — удаляем
        for ch in qa("SELECT * FROM chats WHERE owner=?", (uid,)):
            nxt = q1("""SELECT user_id FROM chat_members WHERE chat_id=? AND user_id!=?
                        ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, joined LIMIT 1""", (ch["id"], uid))
            if nxt:
                run("UPDATE chats SET owner=? WHERE id=?", (nxt["user_id"], ch["id"]))
                run("UPDATE chat_members SET role='owner' WHERE chat_id=? AND user_id=?", (ch["id"], nxt["user_id"]))
            else:
                run("DELETE FROM messages WHERE receiver=?", (-ch["id"],))
                run("DELETE FROM chats WHERE id=?", (ch["id"],))
        run("DELETE FROM chat_members WHERE user_id=?", (uid,))
        run("DELETE FROM unames WHERE uid=?", (uid,))
        run("""UPDATE users SET number=?, tg_id=NULL, name='Удалённый аккаунт', surname='', username='', bio='', bio_ents=NULL, avatar='',
               estatus='', cloud_hash='', cloud_salt='', cloud_hint='', login_email='', prefs='', priv='', biz='', stars=0,
               premium_until=0, nft=0, vtier='', uname_nft=0, uname_ton=0, pchan=0, banned=0, ban_backup='', deleted=1
               WHERE id=?""", (f"deleted:{uid}:{int(time.time())}", uid))
    kick_ws(uid, {"type": "banned", "deleted": 1})
    notify_profile(uid)
    hc_log(f"🗑 {who_label(by)} удалил(а) аккаунт {number} (id {uid}), сообщений: {n}")
    return None, n


def support_dm(t, text, by):
    if t.get("deleted") or t.get("banned"):
        return "Аккаунт заблокирован или удалён — написать нельзя"
    add_message(support_id(), t["id"], text)
    hc_log(f"💬 {who_label(by)} написал(а) от Dicegram Support → {t['number']}: {text[:120]}")
    return None


# ── выдача ──
NFT_UNAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{2,30}[A-Za-z0-9]$")       # NFT-юзернейм: от 4 до 32 символов


def random_ton_price(name):
    """Случайная цена NFT-юзернейма в TON: короче имя — дороже, как на Fragment."""
    n = len(name)
    lo, hi = (800, 8000) if n <= 4 else (150, 1500) if n <= 6 else (40, 400) if n <= 8 else (10, 100)
    return random.randint(lo, hi)


def uname_holder(name):
    """Кому сейчас принадлежит коллекционное имя (строка unames) или None."""
    return q1("SELECT * FROM unames WHERE name=? COLLATE NOCASE", (name or "",))


def check_nft_uname(name, uid):
    """None — имя можно выдать. Коллекционное имя, которое уже у другого человека, администратор может ОТОБРАТЬ
    (оно перейдёт новому владельцу); обычный username или адрес канала отобрать нельзя."""
    if not NFT_UNAME_RE.match(name or "") or "__" in name:
        return "От 4 до 32 символов: латиница, цифры и _, начинается с буквы"
    old = uname_holder(name)
    if old and old["uid"] == uid:
        return "Это имя уже у этого пользователя"
    if old:
        if q1("SELECT 1 FROM users WHERE username=? COLLATE NOCASE AND id!=?", (name, old["uid"])) or q1("SELECT 1 FROM chats WHERE slug=? COLLATE NOCASE", (name,)):
            return "Это имя уже занято"
    elif name_taken(name, skip_user=uid):
        return "Это имя уже занято"
    if name.lower() in RESERVED:
        return "Это имя зарезервировано"
    return None


def grant_stars(t, amt, by):
    run("UPDATE users SET stars=MAX(0, stars+?) WHERE id=?", (amt, t["id"]))
    star_tx(t["id"], amt, "Начислено администратором", "grant")
    notify_profile(t["id"])
    return f"✅ {'+' if amt >= 0 else ''}{amt} ⭐ → {who_label(t)}"


def grant_premium(t, days, by):
    t = fresh(t["id"])
    base = max(int(time.time()), t.get("premium_until") or 0) if days > 0 else int(time.time())
    run("UPDATE users SET premium_until=? WHERE id=?", (base + days * 86400 if days > 0 else 0, t["id"]))
    if days > 0 and not (t.get("estatus") or "") and not t.get("nft"):
        run("UPDATE users SET estatus='b:star' WHERE id=?", (t["id"],))
    notify_profile(t["id"])
    hc_log(f"💎 {who_label(by)}: Premium {('+' + str(days) + ' дн.') if days > 0 else 'отключён'} → {t['number']}")
    return f"✅ Premium {('на ' + str(days) + ' дн.') if days > 0 else 'отключён'} → {who_label(t)}"


def grant_gift(t, key, by):
    e, n, pr, up = GIFTS[key]
    gid = run("""INSERT INTO gifts(from_id,to_id,key,coll,model,backdrop,pattern,num,anon,msg,price,ts,shown)
                 VALUES(?,?,?,'',0,0,0,0,0,'',?,?,1)""", (SYSTEM_ID, t["id"], key, pr, int(time.time()))).lastrowid
    gift_message(SYSTEM_ID, t["id"], q1("SELECT * FROM gifts WHERE id=?", (gid,)), f"🎁 Подарок от создателя: {n}")
    notify_profile(t["id"])
    hc_log(f"🎁 {who_label(by)}: подарок «{n}» → {t['number']}")
    return f"✅ Подарок {e} «{n}» → {who_label(t)}"


def grant_nft(t, coll, backdrop, by, model=None, pattern=None):
    """Выдать NFT-подарок от создателя. model / pattern / backdrop — индексы из MODELS / PATTERNS / BACKDROPS; None — случайно."""
    a = mint(coll, t["id"])
    if not a:
        return "Тираж этой коллекции закончился"
    if backdrop is not None and 0 <= backdrop < len(BACKDROPS):
        a["backdrop"] = backdrop
    if model is not None and 0 <= model < len(MODELS):
        a["model"] = model
    if pattern is not None and 0 <= pattern < len(PATTERNS):
        a["pattern"] = pattern
    price = COLLS[coll][3]
    gid = run("""INSERT INTO gifts(from_id,to_id,key,coll,model,backdrop,pattern,num,anon,msg,price,ts,shown)
                 VALUES(?,?,?,?,?,?,?,?,0,'',?,?,1)""",
              (SYSTEM_ID, t["id"], "c:" + coll, a["coll"], a["model"], a["backdrop"], a["pattern"], a["num"], price, int(time.time()))).lastrowid
    gift_message(SYSTEM_ID, t["id"], q1("SELECT * FROM gifts WHERE id=?", (gid,)), f"🎁 NFT-подарок от создателя: {COLLS[coll][1]}")
    notify_profile(t["id"])
    mo, pt, bd = MODELS[a["model"]][0], PATTERNS[a["pattern"]][0], BACKDROPS[a["backdrop"]][0]
    hc_log(f"💠 {who_label(by)}: NFT «{COLLS[coll][1]} №{a['num']}» ({mo} · {pt} · {bd}) → {t['number']}")
    return f"✅ NFT {COLLS[coll][0]} «{COLLS[coll][1]} №{a['num']}» → {who_label(t)}\n🧬 Модель: {mo}\n✨ Узор: {pt}\n🎨 Фон: {bd}"


def fnum(v, lo, hi):
    """Дробное число из ввода «15», «15.5», «15,5» (иначе None)."""
    try:
        x = float(str(v).strip().replace(" ", "").replace(",", "."))
    except (TypeError, ValueError):
        return None
    return round(x, 2) if x == x and lo <= x <= hi else None


def fmt_ton(x):
    x = float(x or 0)
    return f"{x:.0f}" if x == int(x) else f"{x:.2f}".rstrip("0")


def parse_ton_usd(text):
    """«15», «15.5» или «15 15.73» → (TON, $ или None); None, если не число."""
    parts = str(text or "").replace("$", " ").split()
    ton = fnum(parts[0], 0.01, 10 ** 9) if parts else None
    if ton is None:
        return None
    return ton, (fnum(parts[1], 0.01, 10 ** 9) if len(parts) > 1 else None)


def grant_uname(t, name, price, by, usd=None):
    """Выдать коллекционное имя: основной username человека НЕ меняется — имя добавляется в «а также»."""
    e = check_nft_uname(name, t["id"])
    if e:
        return f"Нельзя выдать @{name}: {e}"
    ton = round(float(price), 2)
    usd = round(float(usd), 2) if usd else round(ton * TON_USD, 2)
    old = uname_holder(name)
    prev = fresh(old["uid"]) if old else None
    with db_lock:
        if old:
            run("DELETE FROM unames WHERE id=?", (old["id"],))          # отбираем у прежнего владельца
            run("UPDATE users SET username='' WHERE id=? AND username=? COLLATE NOCASE", (old["uid"], name))      # если оно было у него основным
        run("INSERT INTO unames(uid,name,ton,usd,ts,by) VALUES(?,?,?,?,?,?)", (t["id"], name, ton, usd, int(time.time()), by["id"] if by else 0))
    notify_profile(t["id"])
    took = ""
    if prev:
        notify_profile(prev["id"])
        try:
            add_message(SYSTEM_ID, prev["id"], f"Коллекционное имя @{name} передано другому пользователю.", auto=True)
        except Exception as e:
            print("uname take notice:", repr(e))
        took = f" Отобран у {who_label(prev)}."
    hc_log(f"🏷 {who_label(by)}: коллекционное имя @{name} ({fmt_ton(ton)} TON, ${usd:.2f}) → {t['number']}" + (f" (отобран у {prev['number']})" if prev else ""))
    return f"✅ @{name} выдан {who_label(t)} как коллекционное имя ({fmt_ton(ton)} TON, ${usd:.2f}). Основной username не изменён." + took


def hc_grant_menu(t):
    uid = t["id"]
    return (f"🎁 Выдача для: {who_label(t)}\nЧто выдать?",
            [[{"t": "⭐ Звёзды", "d": f"g:s:{uid}"}, {"t": "💎 Premium", "d": f"g:p:{uid}"}],
             [{"t": "🎁 Подарок", "d": f"g:g:{uid}"}, {"t": "💠 NFT-подарок", "d": f"g:n:{uid}"}],
             [{"t": "🏷 NFT-юзернейм", "d": f"g:u:{uid}"}]])


def hc_cmd_grant(text, actor):
    """Текстом: «<номер/@ник> stars 500» и т.п. (как раньше) или просто «<номер/@ник>» — дальше кнопками."""
    parts = text.split()
    if not parts:
        return "Напишите номер, @username или ID — дальше выберите кнопками, что выдать.", None
    r = hc_resolve(parts[0])
    if not r or r[0] != "user":
        return "Пользователь не найден.", None
    t = r[1]
    if t.get("deleted") or t.get("banned"):
        return "Аккаунт заблокирован или удалён.", None
    if len(parts) == 1:
        return hc_grant_menu(t)
    what = parts[1].lower()
    arg = parts[2] if len(parts) > 2 else ""
    if what == "username":
        name = arg.lstrip("@")
        pr = parse_ton_usd(" ".join(parts[3:5])) if len(parts) > 3 else None
        return grant_uname(t, name, pr[0] if pr else random_ton_price(name), actor, pr[1] if pr else None), None
    if what == "stars":
        amt = num(arg, -1_000_000, 1_000_000)
        return (grant_stars(t, amt, actor) if amt is not None else "Укажите количество звёзд, например: +88800000001 stars 500"), None
    if what == "premium":
        days = num(arg, -3650, 3650)
        return (grant_premium(t, days, actor) if days is not None else "Укажите число дней, например: +88800000001 premium 30"), None
    if what == "gift":
        return (grant_gift(t, arg, actor) if arg in GIFTS else "Неизвестный подарок. Доступные: " + ", ".join(GIFTS.keys())), None
    if what == "nft":
        return (grant_nft(t, arg, None, actor) if arg in COLLS else "Неизвестная коллекция. Доступные: " + ", ".join(COLLS.keys())), None
    return "Неизвестная команда. Используйте: stars / premium / gift / nft / username — или просто номер.", None


# ── верификация ──
def set_vtier(kind, row, tier, by):
    val = "" if tier == "none" else tier
    if kind == "user":
        run("UPDATE users SET vtier=? WHERE id=?", (val, row["id"]))
        notify_profile(row["id"])
        label = who_label(row)
    else:
        run("UPDATE chats SET vtier=? WHERE id=?", (val, row["id"]))
        push_chat_update(chat_row(row["id"]))
        label = f"#{row['id']}" + (f" «{row['title']}»" if row.get("title") else "")
    hc_log(f"✅ {who_label(by)}: верификация {('«' + val.capitalize() + '»') if val else 'снята'} → {label}")
    if val:
        if val == "blue":
            return f"✅ {label}: синяя галочка (подтверждено администрацией Dicegram)"
        return f"✅ {label}: отметка «{'Major' if val == 'major' else 'Official'}» (подтверждено администрацией Dicegram)"
    return f"✅ Отметка снята: {label}"


def hc_verify_menu(kind, row):
    k = "u" if kind == "user" else "c"
    label = (("🤖 Бот " if row.get("bot") else "") + who_label(row)) if kind == "user" else f"{'Канал' if row['kind'] == 'channel' else 'Группа'} «{row['title']}» (#{row['id']})"
    cur = {"major": "🔷 Major", "official": "⚫️ Official", "blue": "✅ Синяя галочка"}.get(row.get("vtier") or "", "нет")
    return (f"✅ Верификация: {label}\nСейчас: {cur}\nКакую выдать?",
            [[{"t": "✅ Синяя галочка", "d": f"v:{k}:{row['id']}:blue"}],
             [{"t": "🔷 Major", "d": f"v:{k}:{row['id']}:major"}, {"t": "⚫️ Official", "d": f"v:{k}:{row['id']}:official"}],
             [{"t": "❌ Снять отметку", "d": f"v:{k}:{row['id']}:none"}]])


def hc_cmd_verify(text, actor):
    parts = text.split()
    if not parts:
        return "Напишите номер, @username или #id группы/канала.", None
    r = hc_resolve(parts[0])
    if not r:
        return "Не найдено. Укажите номер телефона, @username или #id чата.", None
    kind, row = r
    if len(parts) == 1:
        return hc_verify_menu(kind, row)
    tier = parts[1].lower()
    if tier not in ("blue", "major", "official", "none"):
        return "Укажите: blue (синяя галочка), major, official или none (снять отметку).", None
    return set_vtier(kind, row, tier, actor), None


# ── жалобы ──
REPORT_REASONS = {"spam": "Спам", "scam": "Мошенничество", "abuse": "Оскорбления", "violence": "Насилие",
                  "porn": "Неприемлемый контент", "child": "Нарушение прав детей", "illegal": "Незаконные товары",
                  "fake": "Выдаёт себя за другого", "other": "Другое"}


def report_evidence(reporter, kind, target):
    """Снимок переписки на момент жалобы — доказательство для модерации. Сообщения, которые кто-то из двоих
    удалил «только у себя», тоже попадают (они ещё есть у собеседника); всё, что будет удалено ПОСЛЕ жалобы,
    сохранится в этом снимке."""
    if kind == "user":
        rows = qa("""SELECT * FROM messages WHERE ((sender=? AND receiver=?) OR (sender=? AND receiver=?))
                     AND COALESCE(kind,'text')!='call' ORDER BY id DESC LIMIT 300""", (reporter, target, target, reporter))
    else:
        rows = qa("SELECT * FROM messages WHERE receiver=? ORDER BY id DESC LIMIT 200", (-target,)) if member_row(target, reporter) else []
    msgs = []
    for r in reversed(rows):
        a = meta_load(r["meta"]).get("a") or {}
        msgs.append({"id": r["id"], "from": r["sender"], "ts": r["ts"], "kind": r.get("kind") or "text",
                     "text": decrypt_text(r["text"])[:4000], "name": str(a.get("name") or "")[:120], "fid": r.get("fid") or "",
                     "mime": str(a.get("mime") or "")[:60], "del": 1 if (r.get("del_s") or r.get("del_r")) else 0,
                     "edited": 1 if r.get("edited") else 0})
    return {"msgs": msgs, "taken": int(time.time())}


def hc_report_post(rid):
    r = q1("SELECT * FROM reports WHERE id=?", (rid,))
    if not r:
        return 0
    frm = q1("SELECT * FROM users WHERE id=?", (r["reporter"],))
    if r["kind"] == "user":
        tgt = q1("SELECT * FROM users WHERE id=?", (r["target"],))
        on = who_label(tgt)
    else:
        tgt = chat_row(r["target"])
        on = f"{'канал' if tgt and tgt['kind'] == 'channel' else 'группа'} «{tgt['title'] if tgt else '?'}» (#{r['target']})"
    lines = [f"🚨 Жалоба #{rid} · {REPORT_REASONS.get(r['reason'], r['reason'])}",
             f"👤 От: {who_label(frm)}", f"🎯 На: {on}"]
    if r.get("text"):
        lines.append(f"📝 Комментарий: {r['text']}")
    lines.append(f"🕐 {hc_fmt_ts(r['ts'])}")
    if (r.get("status") or "open") != "open":
        lines.append(f"✅ {r['status']}")
    kb = [[{"t": "👤 Кто пожаловался", "d": f"rep:from:{rid}"}] + ([{"t": "👤 На кого", "d": f"rep:to:{rid}"}] if r["kind"] == "user" else []),
          [{"t": "💬 Посмотреть переписку", "o": f"report:{rid}"}]]
    if (r.get("status") or "open") == "open":
        row2 = [{"t": "✅ Закрыть жалобу", "d": f"rep:close:{rid}"}]
        if r["kind"] == "user" and tgt and not tgt.get("banned") and not tgt.get("deleted"):
            row2.insert(0, {"t": "⛔️ Забанить", "d": f"ban:{r['target']}"})
        kb.append(row2)
    return "\n".join(lines), kb


# ── статистика ──
_peak = {}


def local_day(ts=None):
    return (datetime.fromtimestamp(ts if ts is not None else time.time(), tz=timezone.utc) + timedelta(hours=STATS_TZ)).date()


def day_start_ts(d):
    return int((datetime(d.year, d.month, d.day, tzinfo=timezone.utc) - timedelta(hours=STATS_TZ)).timestamp())


def stats_seen_online():
    """Пиковый онлайн за день: запоминаем максимум одновременно подключённых людей."""
    try:
        n, day = len(clients), local_day().isoformat()
        if n > _peak.get(day, -1):
            if day not in _peak:
                _peak[day] = (kv_get("peak:" + day) or 0)
            if n > _peak[day]:
                _peak[day] = n
                kv_set("peak:" + day, n)
    except Exception as e:
        print("peak:", e)


def stats_text(d0, d1, title):
    """Отчёт за дни [d0, d1] (локальные даты, включительно)."""
    t0, t1 = day_start_ts(d0), day_start_ts(d1 + timedelta(days=1))
    sys_ = tuple(system_ids()) or (0,)
    ph = ",".join("?" * len(sys_))
    c = lambda sql, args: (q1(sql, args) or {}).get("n", 0) or 0
    new = c(f"SELECT COUNT(*) n FROM users WHERE created>=? AND created<? AND is_system=0", (t0, t1))
    msgs = c(f"""SELECT COUNT(*) n FROM messages WHERE ts>=? AND ts<? AND COALESCE(kind,'text') NOT IN ('svc','greet','call')
                 AND sender NOT IN ({ph})""", (t0, t1) + sys_)
    active = c(f"""SELECT COUNT(DISTINCT sender) n FROM messages WHERE ts>=? AND ts<? AND COALESCE(kind,'text') NOT IN ('svc','greet')
                   AND sender NOT IN ({ph})""", (t0, t1) + sys_)
    calls = c("SELECT COUNT(*) n FROM messages WHERE ts>=? AND ts<? AND kind='call'", (t0, t1))
    groups = c("SELECT COUNT(*) n FROM chats WHERE ts>=? AND ts<? AND kind='group'", (t0, t1))
    chans = c("SELECT COUNT(*) n FROM chats WHERE ts>=? AND ts<? AND kind='channel'", (t0, t1))
    stories = c("SELECT COUNT(*) n FROM stories WHERE ts>=? AND ts<?", (t0, t1))
    reps = c("SELECT COUNT(*) n FROM reports WHERE ts>=? AND ts<?", (t0, t1))
    total = c("SELECT COUNT(*) n FROM users WHERE is_system=0 AND COALESCE(deleted,0)=0", ())
    peak, d = 0, d0
    while d <= d1:
        peak = max(peak, int(kv_get("peak:" + d.isoformat()) or 0), _peak.get(d.isoformat(), 0))
        d += timedelta(days=1)
    return (f"📊 {title}\n\n👥 Новых пользователей: +{new}\n💬 Отправлено сообщений: {msgs}\n🙋 Активных пользователей: {active}\n"
            f"📞 Звонков: {calls}\n👪 Новых групп: {groups} · каналов: {chans}\n📸 Историй: {stories}\n"
            f"🔝 Пиковый онлайн: {peak} {ru_plural(peak, 'человек', 'человека', 'человек')}\n🚩 Жалоб: {reps}\n\n"
            f"Всего пользователей: {total}")


STATS_KB = [[{"t": "📅 Сегодня", "d": "st:today"}, {"t": "🗓 7 дней", "d": "st:week"}, {"t": "📆 30 дней", "d": "st:month"}]]


def stats_for(kind):
    today = local_day()
    if kind == "week":
        return stats_text(today - timedelta(days=6), today, f"Последние 7 дней ({(today - timedelta(days=6)).strftime('%d.%m')}–{today.strftime('%d.%m.%Y')})")
    if kind == "month":
        return stats_text(today - timedelta(days=29), today, f"Последние 30 дней ({(today - timedelta(days=29)).strftime('%d.%m')}–{today.strftime('%d.%m.%Y')})")
    return stats_text(today, today, f"За сегодня, {today.strftime('%d.%m.%Y')} (пока)")


def stats_tick():
    """Раз в минуту: после полуночи — итоги вчерашнего дня, в понедельник — итоги прошлой недели."""
    try:
        now_l = datetime.now(timezone.utc) + timedelta(hours=STATS_TZ)
        if now_l.hour == 0 and now_l.minute < 5:
            return
        y = now_l.date() - timedelta(days=1)
        if kv_get("stats_daily") != y.isoformat() and hc_id():
            kv_set("stats_daily", y.isoformat())
            hc_post("stats", stats_text(y, y, f"Итоги дня {y.strftime('%d.%m.%Y')}"), kb=STATS_KB)
        if now_l.weekday() == 0:
            w1 = now_l.date() - timedelta(days=1)
            w0 = w1 - timedelta(days=6)
            if kv_get("stats_weekly") != w1.isoformat() and hc_id():
                kv_set("stats_weekly", w1.isoformat())
                hc_post("stats", stats_text(w0, w1, f"Итоги недели {w0.strftime('%d.%m')}–{w1.strftime('%d.%m.%Y')}"), kb=STATS_KB)
    except Exception as e:
        print("stats_tick:", e)


# ── кнопки под сообщениями бота ──
def back_kb(uid):
    return [[{"t": "« Назад", "d": f"g:{uid}"}]]


def hc_action(u, row, data):
    """Нажатие кнопки под сообщением бота в админ-панели. Возвращает текст всплывающей подсказки (или "")."""
    mid, topic = row["id"], row.get("topic") or 0
    p = data.split(":")
    k = p[0]
    tgt = lambda i: q1("SELECT * FROM users WHERE id=?", (num(p[i], 1, 2 ** 62) or 0,)) if len(p) > i else None
    if k == "noop":
        if len(p) > 1 and p[1] == "cancel":
            hc_edit(mid, "Отменено.", [])
        return ""
    if k == "mt":
        return maint_action(u, row, p)
    if k == "nm":
        t = tgt(1)
        if not t or t.get("deleted"):
            return "Пользователь не найден"
        if t.get("is_system") or t["number"] == ADMIN_NUMBER:
            return "У служебных аккаунтов и владельца номер менять нельзя"
        hc_wait[u["id"]] = {"k": "number", "t": t["id"], "topic": topic, "ts": time.time(), "mid": mid}
        hc_edit(mid, f"📞 {who_label(t)}\nТекущий номер: {t['number']}\n\nНапишите новый номер: +888 и ровно 8 цифр, например +88812345678.",
                [[{"t": "❌ Отмена", "d": "w:cancel"}]])
        return ""
    if k in ("ban", "unban"):
        t = tgt(1)
        if not t:
            return "Пользователь не найден"
        e = ban_user(t, u) if k == "ban" else unban_user(t, u)
        if e:
            return e
        t = fresh(t["id"])
        # если это карточка аккаунта — перерисовываем её, иначе (жалоба) — только кнопки
        if meta_load(row["meta"]).get("card") == t["id"]:
            txt, kb = hc_card(t)
            hc_edit(mid, txt, kb)
        else:
            rep = meta_load(row["meta"]).get("rep")
            if rep:
                txt, kb = hc_report_post(rep)
                hc_edit(mid, txt, kb)
        return "Заблокирован: все сеансы завершены" if k == "ban" else "Разблокирован"
    if k in ("clear", "del"):
        t = tgt(1)
        if not t:
            return "Пользователь не найден"
        what = (f"🧹 Удалить ВСЕ сообщения {who_label(t)}?\nТекст, голосовые, файлы, стикеры, реакции и истории исчезнут у всех. Отменить нельзя."
                if k == "clear" else
                f"🗑 Удалить аккаунт {who_label(t)} полностью?\nПрофиль и все отправленные сообщения будут стёрты, номер освободится. Отменить нельзя.")
        hc_reply(topic, what, [[{"t": "✅ Да, удалить", "d": f"{k}Y:{t['id']}"}, {"t": "❌ Нет", "d": "noop:cancel"}]])
        return ""
    if k == "clearY":
        t = tgt(1)
        if not t:
            return "Пользователь не найден"
        n = clear_user_messages(t, u)
        hc_edit(mid, f"✅ Удалено сообщений: {n} — {who_label(t)}", [])
        return f"Удалено: {n}"
    if k == "delY":
        t = tgt(1)
        if not t:
            return "Пользователь не найден"
        label = who_label(t)
        e, n = delete_account(t, u)
        if e:
            hc_edit(mid, f"❌ {e}", [])
            return e
        hc_edit(mid, f"✅ Аккаунт {label} удалён. Сообщений стёрто: {n}. Номер свободен.", [])
        return "Аккаунт удалён"
    if k == "dm":
        t = tgt(1)
        if not t:
            return "Пользователь не найден"
        hc_wait[u["id"]] = {"k": "dm", "t": t["id"], "topic": topic, "ts": time.time()}
        hc_reply(topic, f"💬 Напишите следующим сообщением текст для {who_label(t)} — он придёт в личку от «{SUPPORT_NAME}».",
                 [[{"t": "❌ Отмена", "d": "w:cancel"}]])
        return ""
    if k == "w" and len(p) > 1 and p[1] == "cancel":
        hc_wait.pop(u["id"], None)
        hc_edit(mid, "Отменено.", [])
        return ""
    if k == "g":
        # g:<uid> — меню выдачи; g:s|p|g|n|u|sx:<uid> — разделы
        if len(p) == 2:
            t = tgt(1)
            if not t:
                return "Пользователь не найден"
            txt, kb = hc_grant_menu(t)
            if meta_load(row["meta"]).get("gm") == t["id"]:
                hc_edit(mid, txt, kb)
            else:
                gid = hc_reply(topic, txt, kb)
                hc_mark(gid, gm=t["id"])
            return ""
        sub, t = p[1], tgt(2)
        if not t:
            return "Пользователь не найден"
        uid = t["id"]
        if sub == "s":
            hc_edit(mid, f"⭐ Сколько звёзд выдать {who_label(t)}?",
                    [[{"t": f"+{x}", "d": f"gs:{uid}:{x}"} for x in (50, 100, 250)],
                     [{"t": f"+{x}", "d": f"gs:{uid}:{x}"} for x in (500, 1000, 5000)],
                     [{"t": "✍️ Другое количество", "d": f"g:sx:{uid}"}]] + back_kb(uid))
        elif sub == "sx":
            hc_wait[u["id"]] = {"k": "stars", "t": uid, "topic": topic, "ts": time.time(), "mid": mid}
            hc_edit(mid, f"⭐ Напишите количество звёзд для {who_label(t)} (со знаком минус — списать).", [[{"t": "❌ Отмена", "d": "w:cancel"}]])
        elif sub == "p":
            hc_edit(mid, f"💎 Premium для {who_label(t)}:",
                    [[{"t": "1 месяц", "d": f"gp:{uid}:30"}, {"t": "3 месяца", "d": f"gp:{uid}:90"}],
                     [{"t": "6 месяцев", "d": f"gp:{uid}:180"}, {"t": "1 год", "d": f"gp:{uid}:365"}],
                     [{"t": "❌ Отключить Premium", "d": f"gp:{uid}:0"}]] + back_kb(uid))
        elif sub == "g":
            keys = list(GIFTS.keys())
            rows_ = [[{"t": f"{GIFTS[x][0]} {GIFTS[x][1]}", "d": f"gg:{uid}:{x}"} for x in keys[i:i + 3]] for i in range(0, len(keys), 3)]
            hc_edit(mid, f"🎁 Какой подарок отправить {who_label(t)}?", rows_ + back_kb(uid))
        elif sub == "n":
            keys = list(COLLS.keys())
            rows_ = [[{"t": f"{COLLS[x][0]} {COLLS[x][1]}", "d": f"gn:{uid}:{x}"} for x in keys[i:i + 2]] for i in range(0, len(keys), 2)]
            hc_edit(mid, f"💠 Какой NFT-подарок выдать {who_label(t)}?", rows_ + back_kb(uid))
        elif sub == "u":
            hc_wait[u["id"]] = {"k": "uname", "t": uid, "topic": topic, "ts": time.time(), "mid": mid}
            hc_edit(mid, f"🏷 Напишите NFT-юзернейм для {who_label(t)}: от 4 до 32 символов (латиница, цифры, _).",
                    [[{"t": "❌ Отмена", "d": "w:cancel"}]])
        return ""
    if k in ("gs", "gp", "gg", "gn", "gnm", "gnp", "gnb", "gu"):
        t = tgt(1)
        if not t:
            return "Пользователь не найден"
        if t.get("banned") or t.get("deleted"):
            return "Аккаунт заблокирован или удалён"
        uid = t["id"]
        if k == "gs":
            amt = num(p[2] if len(p) > 2 else "", -1_000_000, 1_000_000)
            if amt is None:
                return "Неверное количество"
            res = grant_stars(t, amt, u)
            hc_log(f"⭐ {who_label(u)}: {'+' if amt >= 0 else ''}{amt} → {t['number']}")
        elif k == "gp":
            days = num(p[2] if len(p) > 2 else "", 0, 3650)
            if days is None:
                return "Неверный срок"
            res = grant_premium(t, days, u)
        elif k == "gg":
            key = p[2] if len(p) > 2 else ""
            if key not in GIFTS:
                return "Неизвестный подарок"
            res = grant_gift(t, key, u)
        elif k == "gn":
            coll = p[2] if len(p) > 2 else ""
            if coll not in COLLS:
                return "Неизвестная коллекция"
            rows_ = [[{"t": f"{MODELS[i][0]} · {MODELS[i][2] / 10:g}%", "d": f"gnm:{uid}:{coll}:{i}"} for i in range(j, min(j + 2, len(MODELS)))]
                     for j in range(0, len(MODELS), 2)]
            hc_edit(mid, f"🧬 Модель для {COLLS[coll][0]} «{COLLS[coll][1]}» → {who_label(t)}:",
                    rows_ + [[{"t": "🎲 Случайная модель", "d": f"gnm:{uid}:{coll}:-1"}],
                             [{"t": "🎲 Всё случайно", "d": f"gnb:{uid}:{coll}:-1:-1:-1"}]] + back_kb(uid))
            return ""
        elif k == "gnm":
            coll = p[2] if len(p) > 2 else ""
            mi = num(p[3] if len(p) > 3 else "", -1, len(MODELS) - 1)
            if coll not in COLLS or mi is None:
                return "Неверный выбор"
            rows_ = [[{"t": f"{PATTERNS[i][0]} · {PATTERNS[i][2] / 10:g}%", "d": f"gnp:{uid}:{coll}:{mi}:{i}"} for i in range(j, min(j + 2, len(PATTERNS)))]
                     for j in range(0, len(PATTERNS), 2)]
            mn = MODELS[mi][0] if mi >= 0 else "случайная"
            hc_edit(mid, f"✨ Узор для {COLLS[coll][0]} «{COLLS[coll][1]}» (модель: {mn}) → {who_label(t)}:",
                    rows_ + [[{"t": "🎲 Случайный узор", "d": f"gnp:{uid}:{coll}:{mi}:-1"}]] + back_kb(uid))
            return ""
        elif k == "gnp":
            coll = p[2] if len(p) > 2 else ""
            mi = num(p[3] if len(p) > 3 else "", -1, len(MODELS) - 1)
            pi_ = num(p[4] if len(p) > 4 else "", -1, len(PATTERNS) - 1)
            if coll not in COLLS or mi is None or pi_ is None:
                return "Неверный выбор"
            rows_ = [[{"t": BACKDROPS[i][0], "d": f"gnb:{uid}:{coll}:{mi}:{pi_}:{i}"} for i in range(j, min(j + 3, len(BACKDROPS)))]
                     for j in range(0, len(BACKDROPS), 3)]
            mn = MODELS[mi][0] if mi >= 0 else "случайная"
            pn = PATTERNS[pi_][0] if pi_ >= 0 else "случайный"
            hc_edit(mid, f"🎨 Фон для {COLLS[coll][0]} «{COLLS[coll][1]}» (модель: {mn}, узор: {pn}) → {who_label(t)}:",
                    rows_ + [[{"t": "🎲 Случайный фон", "d": f"gnb:{uid}:{coll}:{mi}:{pi_}:-1"}]] + back_kb(uid))
            return ""
        elif k == "gnb":
            coll = p[2] if len(p) > 2 else ""
            if len(p) >= 6:          # gnb:<uid>:<coll>:<модель>:<узор>:<фон>
                mi, pi_, bi = (num(p[3], -1, len(MODELS) - 1), num(p[4], -1, len(PATTERNS) - 1), num(p[5], -1, len(BACKDROPS) - 1))
            else:                    # старый вид gnb:<uid>:<coll>:<фон> — модель и узор случайные
                mi, pi_, bi = -1, -1, num(p[3] if len(p) > 3 else "", -1, len(BACKDROPS) - 1)
            if coll not in COLLS or mi is None or pi_ is None or bi is None:
                return "Неверный выбор"
            res = grant_nft(t, coll, None if bi < 0 else bi, u, None if mi < 0 else mi, None if pi_ < 0 else pi_)
        else:   # gu:<uid>:<name>:<price|r>
            name = p[2] if len(p) > 2 else ""
            price = random_ton_price(name) if (len(p) < 4 or p[3] == "r") else (num(p[3], 1, 10 ** 9) or random_ton_price(name))
            hc_wait.pop(u["id"], None)
            res = grant_uname(t, name, price, u)
        hc_edit(mid, res, back_kb(uid))
        return "Готово" if res.startswith("✅") else res
    if k == "v":
        # v:u|c:<id>:<tier>
        if len(p) < 4 or p[3] not in ("blue", "major", "official", "none"):
            return "Неверный выбор"
        kind = "user" if p[1] == "u" else "chat"
        rid = num(p[2], 1, 2 ** 62) or 0
        row2 = q1("SELECT * FROM users WHERE id=?", (rid,)) if kind == "user" else chat_row(rid)
        if not row2:
            return "Не найдено"
        res = set_vtier(kind, row2, p[3], u)
        txt, kb = hc_verify_menu(kind, q1("SELECT * FROM users WHERE id=?", (rid,)) if kind == "user" else chat_row(rid))
        hc_edit(mid, res + "\n\n" + txt, kb)
        return "Готово"
    if k == "rep":
        rid = num(p[2] if len(p) > 2 else "", 1, 2 ** 62) or 0
        r = q1("SELECT * FROM reports WHERE id=?", (rid,))
        if not r:
            return "Жалоба не найдена"
        if p[1] in ("from", "to"):
            t = q1("SELECT * FROM users WHERE id=?", (r["reporter"] if p[1] == "from" else r["target"],))
            if not t:
                return "Аккаунт не найден"
            txt, kb = hc_card(t)
            cid_ = hc_reply(topic, txt, kb)
            hc_mark(cid_, card=t["id"])
            return ""
        if p[1] == "close":
            run("UPDATE reports SET status=? WHERE id=?", (f"Закрыта: {who_label(u)}, {hc_fmt_ts(time.time())}", rid))
            txt, kb = hc_report_post(rid)
            hc_edit(mid, txt, kb)
            hc_log(f"✅ {who_label(u)} закрыл(а) жалобу #{rid}")
            return "Жалоба закрыта"
    if k == "st":
        hc_reply(topic, stats_for(p[1] if len(p) > 1 else "today"), STATS_KB)
        return ""
    if k == "rep_u":
        t = tgt(1)
        if not t:
            return "Аккаунт не найден"
        txt, kb = hc_card(t)
        hc_mark(hc_reply(topic, txt, kb), card=t["id"])
        return ""
    return "Кнопка устарела"


def hc_mark(mid, **kw):
    """Пометка в сообщении бота: к какому аккаунту/жалобе оно относится (чтобы кнопки потом перерисовали его)."""
    if not mid:
        return
    row = q1("SELECT * FROM messages WHERE id=?", (mid,))
    if not row:
        return
    meta = meta_load(row["meta"])
    meta.update(kw)
    run("UPDATE messages SET meta=? WHERE id=?", (meta_dump(meta), mid))


def hc_input(u, topic, text):
    """Ответ на вопрос бота («напишите количество…»). True — сообщение было этим ответом."""
    w = hc_wait.get(u["id"])
    if not w or w.get("topic") != topic or time.time() - w["ts"] > HC_WAIT_TTL:
        return False
    if str(w.get("k", "")).startswith("mt_"):                  # вопросы карточки «Техработы» — без привязки к пользователю
        hc_wait.pop(u["id"], None)
        return maint_input(u, topic, w, text)
    t = q1("SELECT * FROM users WHERE id=?", (w["t"],))
    hc_wait.pop(u["id"], None)
    if not t:
        hc_reply(topic, "Пользователь не найден.")
        return True
    if w["k"] == "dm":
        e = support_dm(t, text[:4000], u)
        hc_reply(topic, f"❌ {e}" if e else f"✅ Отправлено от «{SUPPORT_NAME}» → {who_label(t)}")
    elif w["k"] == "stars":
        amt = num(text.strip().replace(" ", ""), -1_000_000, 1_000_000)
        if amt is None:
            hc_wait[u["id"]] = dict(w, ts=time.time())
            hc_reply(topic, "Нужно целое число, например 750 или -100. Напишите ещё раз.")
        else:
            res = grant_stars(t, amt, u)
            hc_log(f"⭐ {who_label(u)}: {'+' if amt >= 0 else ''}{amt} → {t['number']}")
            if w.get("mid"):
                hc_edit(w["mid"], res, back_kb(t["id"]))
            else:
                hc_reply(topic, res)
    elif w["k"] == "uname":
        name = text.strip().lstrip("@")
        e = check_nft_uname(name, t["id"])
        if e:
            hc_wait[u["id"]] = dict(w, ts=time.time())
            hc_reply(topic, f"Нельзя: {e}. Напишите другое имя.")
        else:
            hc_wait[u["id"]] = {"k": "uprice", "t": t["id"], "topic": topic, "ts": time.time(), "name": name, "mid": w.get("mid")}
            pr = random_ton_price(name)
            hold = uname_holder(name)
            hp = fresh(hold["uid"]) if hold else None
            hc_reply(topic, (f"🏷 @{name} сейчас у {who_label(hp)} — выдам новому владельцу, а у него заберу.\n" if hp else f"🏷 @{name} свободен — ") + f"выдам как коллекционное имя (основной username человека не изменится).\n"
                            f"Сколько TON он стоит? Напишите число, например 15 или 15.5. Если хотите указать и сумму в $, добавьте её через пробел: 15 15.73 "
                            f"(иначе $ посчитаю по курсу). Или нажмите кнопку.",
                     [[{"t": f"🎲 Случайная цена ({pr} TON)", "d": f"gu:{t['id']}:{name}:{pr}"}], [{"t": "❌ Отмена", "d": "w:cancel"}]])
    elif w["k"] == "number":
        new = parse_new_number(text)
        if not new:
            hc_wait[u["id"]] = dict(w, ts=time.time())
            hc_reply(topic, "Номер должен быть строго +888 и ровно 8 цифр после него (всего 11 цифр), например +88812345678. Напишите ещё раз.")
        else:
            res = change_user_number(t, new, u)
            if res.startswith("❌"):
                hc_wait[u["id"]] = dict(w, ts=time.time())
                hc_reply(topic, res + "\nНапишите другой номер или нажмите «Отмена».", [[{"t": "❌ Отмена", "d": "w:cancel"}]])
            else:
                if w.get("mid"):
                    hc_edit(w["mid"], res, [])
                else:
                    hc_reply(topic, res)
    elif w["k"] == "uprice":
        price = parse_ton_usd(text)
        if price is None:
            hc_wait[u["id"]] = dict(w, ts=time.time())
            hc_reply(topic, "Нужно число TON, например 15 или 15.5 (можно добавить цену в $ через пробел).")
        else:
            res = grant_uname(t, w["name"], price[0], u, price[1])
            if w.get("mid"):
                hc_edit(w["mid"], res, back_kb(t["id"]))
            else:
                hc_reply(topic, res)
    return True


def hc_dispatch(ch, u, topic, text):
    """Сообщение участника в теме админ-панели → команда; бот отвечает тут же (с кнопками)."""
    if not topic:
        return
    hch, topics = ensure_helpcreator()
    if not topics or not hch or hch["id"] != ch["id"] or not member_row(ch["id"], u["id"]):
        return
    if hc_input(u, topic, text):
        return
    key = next((k for k, v in topics.items() if v == topic), None)
    if not key or key in ("logs", "new", "reports"):
        return
    reply, kb, mark = None, None, {}
    try:
        if key == "info":
            reply, kb = hc_cmd_info(text)
            r = hc_resolve(text)
            if kb and r and r[0] == "user":
                mark = {"card": r[1]["id"]}
        elif key == "grant":
            reply, kb = hc_cmd_grant(text, u)
            r = hc_resolve(text.split()[0]) if text.split() else None
            if kb and r and r[0] == "user":
                mark = {"gm": r[1]["id"]}
        elif key == "verify":
            reply, kb = hc_cmd_verify(text, u)
        elif key == "numbers":
            reply, kb = hc_cmd_numbers(text)
        elif key == "maint":
            reply, kb = maint_card()
        elif key == "stats":
            low = text.strip().lower()
            kind = "week" if "нед" in low or "7" in low else "month" if "мес" in low or "30" in low else "today"
            reply, kb = stats_for(kind), STATS_KB
    except Exception as e:
        reply = f"Ошибка: {e}"
    if reply:
        mid = hc_reply(topic, reply, kb)
        if mark:
            hc_mark(mid, **mark)


@app.post("/api/hc/cb")
def hc_cb():
    """Нажатие кнопки под сообщением бота в админ-панели. Только для участников admin-panel."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    d = body()
    mid = num(d.get("id"), 1, 2 ** 62) or 0
    data = str(d.get("d") or "")[:160]
    row = q1("SELECT * FROM messages WHERE id=?", (mid,))
    ch, _ = ensure_helpcreator()
    if not row or not ch or row["receiver"] != -ch["id"] or row["sender"] != SYSTEM_ID:
        return err("Кнопка недоступна", 404)
    if not member_row(ch["id"], u["id"]):
        return err("Нет доступа", 403)
    if not hit("hccb", u["id"], 40, 20):
        return err("Слишком часто", 429)
    try:
        res = hc_action(u, row, data)
    except Exception as e:
        print("hc_action:", repr(e))
        res = f"Ошибка: {e}"
    return jsonify(ok=True, toast=res or "")


@app.get("/api/hc/report/<int:rid>")
def hc_report_view(rid):
    """Переписка-доказательство по жалобе. Только участникам admin-panel; каждый просмотр — в «Логи»."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    if not hc_member(u["id"]):
        return err("Нет доступа", 403)
    r = q1("SELECT * FROM reports WHERE id=?", (rid,))
    if not r:
        return err("Жалоба не найдена", 404)
    try:
        ev = json.loads(decrypt_text(r["evidence"])) if r.get("evidence") else {"msgs": []}
    except Exception:
        ev = {"msgs": []}
    ids = {r["reporter"]} | ({r["target"]} if r["kind"] == "user" else set()) | {m["from"] for m in ev.get("msgs", [])}
    users = {}
    for x in (qa(f"SELECT * FROM users WHERE id IN ({','.join('?' * len(ids))})", list(ids)) if ids else []):
        users[x["id"]] = {"id": x["id"], "name": " ".join(y for y in (x["name"], x.get("surname")) if y) or "Пользователь",
                          "number": x["number"] if not str(x["number"]).startswith("deleted:") else "", "avatar": x.get("avatar") or "",
                          "banned": 1 if x.get("banned") else 0}
    msgs = []
    for m in ev.get("msgs", []):
        o = dict(m)
        if o.get("fid"):
            o["url"] = file_url(o["fid"], u["id"])
        o.pop("fid", None)
        msgs.append(o)
    hc_log(f"👁 {who_label(u)} открыл(а) переписку по жалобе #{rid}")
    tgt = chat_row(r["target"]) if r["kind"] == "chat" else None
    return jsonify(ok=True, report={"id": rid, "kind": r["kind"], "reporter": r["reporter"], "target": r["target"],
                                    "reason": REPORT_REASONS.get(r["reason"], r["reason"]), "text": r.get("text") or "",
                                    "ts": r["ts"], "taken": ev.get("taken") or r["ts"], "status": r.get("status") or "open",
                                    "chat": tgt["title"] if tgt else ""},
                   users=users, messages=msgs)


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
    try:
        hc_post("reports", f"🆘 Обращение в поддержку\n👤 От: {who_label(u)}\n\n{text[:1500]}",
                kb=[[{"t": "💬 Ответить", "d": f"dm:{u['id']}"}, {"t": "🔎 Инфо", "d": f"rep_u:{u['id']}"}]])
    except Exception as e:
        print("support → admin-panel:", e)
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
PUB_SLUG_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{4,31}$")
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
    if vt in ("major", "official", "blue"):
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
    if ch["kind"] == "channel":
        d["gifts_n"] = (q1("SELECT COUNT(*) n FROM gifts WHERE to_id=? AND shown=1 AND sold=0 AND key NOT LIKE 'prem:%'", (-ch["id"],)) or {}).get("n", 0)
    d.update({"hist": int(ch["hist"] or 0), "greet": ch["greet"] or "", "greet_on": int(ch["greet_on"] or 0), "perms_all": chat_perms(ch),
              "auto_del": ch["auto_del"] or 0, "sign": int(ch["sign"] or 0),
              "pfmt": link_url("{s}", "p")})            # шаблон публичной ссылки: {s} заменяется адресом
    if m and (m["role"] in ("owner", "admin")):
        d["admins"] = (q1("SELECT COUNT(*) n FROM chat_members WHERE chat_id=? AND role IN ('owner','admin')", (ch["id"],)) or {}).get("n", 0)
        d["banned"] = (q1("SELECT COUNT(*) n FROM chat_bans WHERE chat_id=?", (ch["id"],)) or {}).get("n", 0)
        d["links"] = (q1("SELECT COUNT(*) n FROM chat_links WHERE chat_id=? AND revoked=0", (ch["id"],)) or {}).get("n", 0)
    if m and can_do(ch, m, "invite"):
        d["reqs"] = (q1("SELECT COUNT(*) n FROM chat_reqs WHERE chat_id=?", (ch["id"],)) or {}).get("n", 0)
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


def add_gmessage(ch, sender, text, cid=None, kind="text", ents=None, att=None, reply_to=None, fw=None, topic=0, svc=None, only=0, kb=None, extra=None):
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
                   meta_dump({"e": ents, "a": att, "fw": fw, "s": svc, "kb": kb, **(extra or {})}), reply_to,
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
    try:
        bot_group_hook(ch, q1("SELECT * FROM messages WHERE id=?", (msg["id"],)), u)
    except Exception as e:
        print("bot_group_hook:", repr(e))
    if topic and text and is_hc(ch["id"]):
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
    """Публичные ссылки — только на своём домене, как в Telegram:
       профиль /<имя>, группа или канал /<имя>, сообщение /<имя>/<номер>, медиа /<имя>/<номер>?single,
       приглашение /+КОД, закрытый чат (для участников) /c/<номер чата>/<номер сообщения>."""
    b, sl = PUBLIC_BASE, str(slug)
    if pref == "j":
        return f"{b}/+{sl}"
    if pref == "u":
        return f"{b}/{sl}"
    if pref == "e":
        return f"{b}/addemoji/{sl}"
    if pref == "c":
        return f"{b}/biz/{sl}"
    mm = re.fullmatch(r"(.+?)-(\d+)(-s)?", sl)
    if pref == "k":
        return f"{b}/c/{mm.group(1)}/{mm.group(2)}" + ("?single" if mm.group(3) else "") if mm else f"{b}/c/{sl}"
    if mm:
        return f"{b}/{mm.group(1)}/{mm.group(2)}" + ("?single" if mm.group(3) else "")
    return f"{b}/{sl}"


@app.post("/api/link")
def link_make():
    """Ссылки как в Telegram: {kind:"user", id} — профиль (по @имени); {kind:"chat", id} — группа/канал;
    {kind:"msg", id: id_чата, mid, single?} — конкретное сообщение (single — открыть медиа отдельно).
    Публичный чат — ссылка по адресу (#p=адрес-сообщение), закрытый — по номеру чата (#k=…), откроется только участникам."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    d = body()
    kind = str(d.get("kind") or "")
    if kind == "user":
        t = q1("SELECT * FROM users WHERE id=?", (num(d.get("id"), 1, 2 ** 62) or 0,))
        if not t or t.get("banned") or t.get("deleted"):
            return err("Аккаунт не найден", 404)
        if not t.get("username"):
            return err("У этого аккаунта нет имени пользователя (@username) — поделиться ссылкой нельзя")
        return jsonify(ok=True, url=link_url(t["username"], "u"))
    if kind not in ("chat", "msg"):
        return err("Неизвестная ссылка")
    cid = abs(num(d.get("id"), -2 ** 62, 2 ** 62) or 0)
    ch = chat_row(cid)
    m = member_row(cid, u["id"]) if ch else None
    if not ch or is_hc(cid) or (not ch["slug"] and not m):
        return err("Нет доступа", 403)
    base, pref = (ch["slug"], "p") if ch["slug"] else (str(cid), "k")
    if kind == "chat":
        return jsonify(ok=True, url=link_url(base, pref), public=bool(ch["slug"]))
    mid = num(d.get("mid"), 1, 2 ** 62) or 0
    row = q1("SELECT * FROM messages WHERE id=? AND receiver=?", (mid, -cid))
    if not row or (m and row["id"] < (m.get("first_id") or 0)):
        return err("Сообщение не найдено", 404)
    return jsonify(ok=True, url=link_url(f"{base}-{mid}" + ("-s" if d.get("single") else ""), pref), public=bool(ch["slug"]))


@app.get("/api/msglink")
def msglink_resolve():
    """Куда ведёт ссылка на сообщение: чат (если есть доступ) и существует ли ещё сообщение."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    slug, cid = str(request.args.get("p") or ""), request.args.get("k", type=int) or 0
    mid = request.args.get("m", type=int) or 0
    ch = q1("SELECT * FROM chats WHERE slug=? COLLATE NOCASE", (slug,)) if slug else chat_row(cid)
    if not ch or is_hc(ch["id"]):
        return err("Ссылка недействительна", 404)
    m = member_row(ch["id"], u["id"])
    if not m and not ch["slug"]:
        return jsonify(ok=False, error="Это закрытая группа или канал — сообщение видно только участникам", private=True), 403
    row = q1("SELECT * FROM messages WHERE id=? AND receiver=?", (mid, -ch["id"])) if mid else None
    exists = bool(row) and (not m or row["id"] >= (m.get("first_id") or 0) or ch["kind"] == "channel" or ch["hist"])
    return jsonify(ok=True, chat=chat_public(ch, m), joined=bool(m), exists=exists, topic=(row or {}).get("topic") or 0,
                   slug=ch["slug"] or "")


def link_out(l):
    return {"slug": l["slug"], "url": link_url(l["slug"]), "title": l["title"] or "", "prim": int(l["prim"]), "expires": l["expires"] or 0,
            "lim": l["lim"] or 0, "uses": l["uses"] or 0, "revoked": int(l["revoked"]), "creator": l["creator"], "ts": l["ts"],
            "req": int(l.get("req") or 0)}


def join_chat(ch, uid, adder=0, by=None):
    """Добавить человека в чат. True — вошёл сейчас, False — уже был. Ошибка — ValueError.
    adder — кто стоит в chat_members.adder (для прав: кого назначил/добавил этот человек);
    by — кто на самом деле совершил вход, для журнала действий (по умолчанию — сам uid, то есть самостоятельный вход,
    даже если adder указывает на создателя пригласительной ссылки)."""
    cid = ch["id"]
    if is_hc(cid):
        owner = get_admin_user()
        if not owner or (by if by is not None else uid) != owner["id"]:
            raise ValueError("В эту группу нельзя вступить")
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


def add_members(ch, actor, ids, skipped=None):
    """Добавить нескольких человек: одно служебное сообщение «X добавил(а) …». Возвращает список добавленных."""
    added = []
    au = q1("SELECT * FROM users WHERE id=?", (actor,)) or {}
    for i in ids:
        tu = q1("SELECT * FROM users WHERE id=?", (i,))
        if tu and not is_admin(au) and not priv_ok(tu, "invite", actor):     # человек закрыл приглашения в группы и каналы
            if skipped is not None:
                skipped.append({"id": i, "name": tu.get("name") or "Пользователь"})
            continue
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
    sl = str(d.get("slug") or "").strip().lstrip("@")
    if d.get("public") or sl:                                   # публичный чат: адрес обязателен, 5–32 символа
        if not PUB_SLUG_RE.match(sl):
            return err("Адрес публичной ссылки обязателен: от 5 до 32 символов — латиница, цифры, _. Должен начинаться с буквы")
        if name_reserved(sl, u):
            return err("Этот адрес зарезервирован")
        if name_taken(sl):
            return err("Такой адрес уже занят")
    now = int(time.time())
    with db_lock:
        if sl and name_taken(sl):
            return err("Такой адрес уже занят")
        cid = run("INSERT INTO chats(kind,title,about,owner,ts,auto_del,slug) VALUES(?,?,?,?,?,?,?)", (kind, title, about, u["id"], now, auto, sl)).lastrowid
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
    skipped = []
    if ids:
        add_members(chat_row(cid), u["id"], ids, skipped)
    ch = chat_row(cid)
    return jsonify(ok=True, chat=chat_full(ch, member_row(cid, u["id"])), skipped=skipped)


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
            if sl and is_hc(cid):
                return err("У admin-panel не может быть публичного адреса", 403)
            if sl and not PUB_SLUG_RE.match(sl):
                return err("Адрес: от 5 до 32 символов — латиница, цифры, _. Должен начинаться с буквы")
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
    if is_hc(cid) and u["number"] != ADMIN_NUMBER:
        return err("Добавлять участников в admin-panel может только владелец", 403)
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
    skipped = []
    added = add_members(ch, u["id"], ids, skipped)
    return jsonify(ok=True, added=added, skipped=skipped, chat=chat_full(chat_row(cid), member_row(cid, u["id"])))


@app.post("/api/bot/add_to_chat")
def bot_add_to_chat():
    """{bot, chat} — добавить бота в группу или канал (кнопка «Добавить в канал или группу» в профиле бота)."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    d = body()
    bid, cid = num(d.get("bot"), 1, 2 ** 62) or 0, num(d.get("chat"), 1, 2 ** 62) or 0
    b, bu = bot_row(bid), q1("SELECT * FROM users WHERE id=?", (bid,))
    if not b or not bu or not bu.get("bot") or bu.get("deleted") or bu.get("banned"):
        return err("Бот не найден", 404)
    if bid == dicebot_id():
        return err("Dicebot нельзя добавить в чат")
    ch, m = ctx(u, cid)
    if not ch or not m:
        return err("Нет доступа", 403)
    if not can_do(ch, m, "invite"):
        return err("Нет прав на добавление участников", 403)
    if is_hc(cid):
        return err("Сюда нельзя добавлять ботов", 403)
    if not b["groups_ok"]:
        return err("Владелец запретил добавлять этого бота в группы и каналы")
    if not hit("botadd", u["id"], 20, 60):
        return err("Слишком часто. Подождите минуту", 429)
    if q1("SELECT 1 FROM chat_bans WHERE chat_id=? AND user_id=?", (cid, bid)):
        run("DELETE FROM chat_bans WHERE chat_id=? AND user_id=?", (cid, bid))
    try:
        joined = join_chat(ch, bid, u["id"], by=u["id"])
    except ValueError as e:
        return err(str(e))
    if not joined:
        return jsonify(ok=False, error="Бот уже в этом чате", already=True), 409
    if ch["kind"] == "group":
        svc_add(ch, u["id"], "add", [bid])
    push_chat_update(ch)
    return jsonify(ok=True, chat=chat_full(chat_row(cid), member_row(cid, u["id"])))


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
    if is_hc(cid):
        return err("В эту группу нельзя пригласить по ссылке", 403)
    d = body()
    if (q1("SELECT COUNT(*) n FROM chat_links WHERE chat_id=? AND revoked=0", (cid,)) or {}).get("n", 0) >= MAX_LINKS:
        return err("Можно создать не больше %d ссылок" % MAX_LINKS)
    exp_in = num(d.get("expires_in"), 0, 366 * 86400) or 0
    lim = num(d.get("lim"), 0, 99999) or 0
    slug = secrets.token_urlsafe(12).replace("-", "A").replace("_", "B")[:16]
    run("INSERT INTO chat_links(slug,chat_id,creator,title,prim,expires,lim,ts,req) VALUES(?,?,?,?,0,?,?,?,?)",
        (slug, cid, u["id"], str(d.get("title") or "").strip()[:32], int(time.time()) + exp_in if exp_in else 0, lim, int(time.time()),
         1 if d.get("req") else 0))
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
    run("UPDATE chat_links SET title=?, expires=?, lim=?, req=? WHERE slug=?",
        (str(d.get("title") or "").strip()[:32], int(time.time()) + exp_in if exp_in else 0, num(d.get("lim"), 0, 99999) or 0,
         (1 if d.get("req") else 0) if "req" in d else int(l.get("req") or 0), l["slug"]))
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
    if l and l.get("req") and not m:
        d["req"] = 1                                        # вход только по заявке — клиент покажет «Отправить запрос»
        d["requested"] = bool(q1("SELECT 1 FROM chat_reqs WHERE chat_id=? AND user_id=?", (ch["id"], u["id"])))
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
        if not ch or l["revoked"] or is_hc(ch["id"]):
            return None, None
        if l["expires"] and l["expires"] < time.time():
            return None, None
        if l["lim"] and l["uses"] >= l["lim"]:
            return None, None
        return ch, l
    ch = q1("SELECT * FROM chats WHERE slug=? COLLATE NOCASE", (slug,))
    return (ch, None) if ch and not is_hc(ch["id"]) else (None, None)


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
    if l and l.get("req") and not member_row(ch["id"], u["id"]):
        # ссылка «с одобрением»: вместо входа создаём заявку, участником человек станет после решения админа
        if q1("SELECT 1 FROM chat_bans WHERE chat_id=? AND user_id=?", (ch["id"], u["id"])):
            return err("Вы заблокированы в этом канале" if ch["kind"] == "channel" else "Вы заблокированы в этой группе", 403)
        if not q1("SELECT 1 FROM chat_reqs WHERE chat_id=? AND user_id=?", (ch["id"], u["id"])):
            if (q1("SELECT COUNT(*) n FROM chat_reqs WHERE chat_id=?", (ch["id"],)) or {}).get("n", 0) >= MAX_REQS:
                return err("Слишком много заявок. Попробуйте позже", 429)
            run("INSERT OR REPLACE INTO chat_reqs(chat_id,user_id,slug,ts) VALUES(?,?,?,?)", (ch["id"], u["id"], l["slug"], int(time.time())))
            notify_reqs(ch, u)
        return jsonify(ok=True, joined=False, requested=True, chat=chat_public(ch, None))
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


# ── заявки на вступление ──
MAX_REQS = 500


def notify_reqs(ch, who):
    """Сообщить онлайн-админам, что пришла новая заявка (клиент обновит счётчик и покажет уведомление)."""
    n = (q1("SELECT COUNT(*) n FROM chat_reqs WHERE chat_id=?", (ch["id"],)) or {}).get("n", 0)
    for mid in member_ids(ch["id"]):
        if not clients.get(mid):
            continue
        mr = member_row(ch["id"], mid)
        if mr and can_do(ch, mr, "invite"):
            push(mid, {"type": "joinreq", "chat": -ch["id"], "gid": ch["id"], "n": n, "title": ch["title"],
                       "user": {"id": who["id"], "name": uname(who["id"])}})


@app.get("/api/chat/<int:cid>/requests")
def chat_requests(cid):
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    ch, m = ctx(u, cid)
    if not ch or not m or not link_check(ch, m):
        return err("Нет прав", 403)
    rows = qa("SELECT * FROM chat_reqs WHERE chat_id=? ORDER BY ts LIMIT 200", (cid,))
    out = []
    for r in rows:
        usr = q1("SELECT * FROM users WHERE id=?", (r["user_id"],))
        if not usr or usr.get("deleted") or usr.get("banned"):
            continue
        out.append({"user": public(usr, False, u), "ts": r["ts"], "slug": r["slug"]})
    return jsonify(ok=True, requests=out, n=len(out))


@app.post("/api/chat/<int:cid>/request/decide")
def chat_request_decide(cid):
    """Одобрить или отклонить заявку: {uid, ok} или {all: true, ok}."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    ch, m = ctx(u, cid)
    if not ch or not m or not link_check(ch, m):
        return err("Нет прав", 403)
    d = body()
    ok = bool(d.get("ok"))
    if d.get("all"):
        ids = [r["user_id"] for r in qa("SELECT user_id FROM chat_reqs WHERE chat_id=? ORDER BY ts LIMIT 200", (cid,))]
    else:
        ids = [num(d.get("uid"), 1, 1 << 40)]
    done, failed = 0, []
    for uid in ids:
        r = q1("SELECT * FROM chat_reqs WHERE chat_id=? AND user_id=?", (cid, uid)) if uid else None
        if not r:
            continue
        run("DELETE FROM chat_reqs WHERE chat_id=? AND user_id=?", (cid, uid))
        if not ok:
            done += 1
            continue
        l = q1("SELECT * FROM chat_links WHERE slug=?", (r["slug"],))
        try:
            joined = join_chat(ch, uid, (l or {}).get("creator") or 0, by=u["id"])
        except ValueError as e:
            failed.append({"id": uid, "error": str(e)})
            continue
        done += 1
        if joined:
            if l:
                run("UPDATE chat_links SET uses=uses+1 WHERE slug=?", (l["slug"],))
            if ch["kind"] == "group":
                svc_add(ch, uid, "join")
            send_greeting(ch, uid)
        push(uid, {"type": "joinok", "chat": chat_public(ch, member_row(cid, uid)), "gid": cid})
    if done:
        push_chat_update(ch)
    left = (q1("SELECT COUNT(*) n FROM chat_reqs WHERE chat_id=?", (cid,)) or {}).get("n", 0)
    return jsonify(ok=True, done=done, failed=failed, n=left)


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


@app.get("/api/gallery")
def gallery_list():
    """Галерея внутри приложения: фото и видео из всех чатов пользователя (новые сверху), постранично ?before=<id>.
    Повторная отправка из галереи — по fid, без новой загрузки (доступ проверяет clean_att → can_access)."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    if not hit("gallery", u["id"], 60, 60):
        return err("Слишком часто. Попробуйте позже", 429)
    uid = u["id"]
    before = request.args.get("before", type=int) or 2 ** 62
    lim = max(10, min(200, request.args.get("limit", type=int) or 150))
    rows = qa("""SELECT m.* FROM messages m JOIN files f ON f.fid = m.fid
                 WHERE m.id < :b AND m.fid IS NOT NULL AND m.fid != '' AND f.done = 1
                   AND (f.mime LIKE 'image/%' OR f.mime LIKE 'video/%') AND COALESCE(m.kind,'') IN ('photo','file','gif')
                   AND ((m.sender=:me AND m.del_s=0 AND m.receiver>0) OR (m.receiver=:me AND m.del_r=0) OR
                        (m.receiver<0 AND EXISTS(SELECT 1 FROM chat_members c WHERE c.chat_id=-m.receiver AND c.user_id=:me
                                                 AND m.id>=c.first_id AND (m.only_u=0 OR m.only_u=:me))))
                   AND (m.exp IS NULL OR m.exp=0 OR m.exp > :now)
                 ORDER BY m.id DESC LIMIT :lim""", {"b": before, "me": uid, "lim": lim, "now": int(time.time())})
    more = len(rows) == lim
    seen, items, peers = set(), [], {}
    msgs = ser_many(rows, uid)
    for r, mm in zip(rows, msgs):
        a = mm.get("att") or {}
        if not a.get("fid") or a["fid"] in seen:
            continue
        seen.add(a["fid"])
        pid = r["receiver"] if r["receiver"] < 0 else (r["receiver"] if r["sender"] == uid else r["sender"])
        if pid not in peers:
            if pid < 0:
                ch = chat_row(-pid)
                peers[pid] = (ch["title"] if ch else "") or "Чат"
            elif pid == uid:
                peers[pid] = "Избранное"
            else:
                p = q1("SELECT * FROM users WHERE id=?", (pid,))
                peers[pid] = ("Удалённый аккаунт" if (p.get("banned") or p.get("deleted")) else dm_title(uid, p)) if p else "Пользователь"
        items.append({"mid": r["id"], "ts": r["ts"], "peer": pid, "att": {k: a.get(k) for k in ("fid", "tfid", "url", "turl", "w", "h", "dur", "mime", "name", "size") if a.get(k) is not None}})
    return jsonify(ok=True, items=items, peers={str(k): v for k, v in peers.items()}, more=more,
                   next=rows[-1]["id"] if rows else 0)


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
        run("""INSERT INTO fcm_tokens(user_id,token,install,sess,ts) VALUES(?,?,?,?,?)
               ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id, install=excluded.install, sess=excluded.sess, ts=excluded.ts""",
            (u["id"], tok, inst, token_hash(get_token()), int(time.time())))
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
        tu = q1("SELECT banned, deleted FROM users WHERE id=?", (to,)) or {}
        if tu.get("banned") or tu.get("deleted") or (not clients.get(to) and not has_push(to)):
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
        rtc_push(uid, {"type": "rtc", "call": cid, "k": "answered"})    # остальные устройства и уведомление в шторке перестают звонить
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
    elif t == "typing":
        typing_handle(uid, d)


TYPING_ACTS = ("typing", "voice", "video", "file", "photo", "sticker")


def typing_handle(uid, d):
    """«печатает…» / «записывает голосовое…»: собеседнику (если не заблокировал) или участникам группы,
    кто сейчас в сети. Имя — как отправитель записан в контактах у каждого получателя."""
    if not hit("typing", uid, 25, 10):
        return
    to = num(d.get("to"), -2 ** 62, 2 ** 62) or 0
    act = d.get("act") if d.get("act") in TYPING_ACTS else "typing"
    if to > 0:
        if to == uid or not clients.get(to) or block_err(uid, to):
            return
        push(to, {"type": "typing", "chat": uid, "from": uid, "act": act})
        return
    if to < 0:
        ch = chat_row(-to)
        m = member_row(-to, uid) if ch else None
        if not ch or not m or ch["kind"] != "group" or not can_write(ch, m):
            return
        s_ = q1("SELECT * FROM users WHERE id=?", (uid,)) or {}
        topic = num(d.get("topic"), 0, 2 ** 62) or 0
        for v in member_ids(ch["id"]):
            if v != uid and clients.get(v):
                push(v, {"type": "typing", "chat": to, "from": uid, "act": act, "topic": topic, "name": dm_title(v, s_)})


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
    _mt = maint_get()
    if _mt["on"] and u.get("number") not in _mt["wl"]:               # идут техработы: обычным пользователям сообщаем и не подключаем
        try:
            ws.send(json.dumps({"type": "maint", **maint_pub(_mt)}))
            ws.close()
        except Exception:
            pass
        return
    first_conn = not clients.get(uid)
    clients.setdefault(uid, set()).add(ws)
    ws_tok[ws] = token_h
    if first_conn:
        stats_seen_online()
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
    n = 0
    while True:
        time.sleep(10)
        n += 1
        try:
            sweep_expired()
            call_sweep()
            if n % 6 == 0:
                stats_tick()                     # раз в минуту: ежедневный/еженедельный отчёт в admin-panel
                for k_, w_ in list(hc_wait.items()):
                    if time.time() - w_["ts"] > HC_WAIT_TTL:
                        hc_wait.pop(k_, None)
        except Exception as e:
            print("expiry error:", e)


def maintenance_loop():
    while True:
        time.sleep(3600)
        try:
            now = int(time.time())
            run("DELETE FROM sessions WHERE COALESCE(NULLIF(last_used,0),created) < ?", (now - SESSION_TTL,))
            fcm_gc()
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
            bots_gc()
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
        if t.get("banned") or t.get("deleted"):
            return err("Этот аккаунт уже удалён")
        label = t["name"] or str(tid)
    else:
        t = chat_row(tid)
        if not t:
            return err("Чат не найден", 404)
        label = t["title"]
    if not hit("report", u["id"], 10, 3600):
        return err("Слишком много жалоб. Попробуйте позже", 429)
    text = str(d.get("text") or "").strip()[:500]
    evd = report_evidence(u["id"], kind, tid)
    ev = encrypt_text(json.dumps(evd, ensure_ascii=False))
    rid = run("INSERT INTO reports(reporter,kind,target,reason,text,ts,status,evidence) VALUES(?,?,?,?,?,?,'open',?)",
              (u["id"], kind, tid, reason, text, int(time.time()), ev)).lastrowid
    for m_ in evd["msgs"]:
        if m_.get("fid"):
            run("INSERT OR IGNORE INTO report_files(rid,fid) VALUES(?,?)", (rid, m_["fid"]))
    alert_admin(f"🚩 Жалоба ({REPORT_REASONS[reason]})\nНа: {label} [{kind} {tid}]\nОт: {u['name']} [{u['id']}]\n{text}")
    try:
        txt, kb = hc_report_post(rid)
        mid = hc_post("reports", txt, kb=kb)
        hc_mark(mid, rep=rid)
    except Exception as e:
        print("report → admin-panel:", e)
    return jsonify(ok=True)


# ── подарки и коллекционные NFT ──
# Два раздела. Обычные подарки покупают, дарят и коллекционируют; улучшать их нельзя.
# NFT-подарки — отдельная категория: у каждого свой номер, модель, фон и узор; только NFT можно улучшать (до трёх раз),
# и каждое улучшение даёт более редкое сочетание. Внешний вид (3D-модель) рисует клиент по ключам из этих таблиц.
# обычные: ключ → (значок для бота, название, цена, «» — улучшить нельзя)
GIFTS = {
    "heart": ("❤️", "Сердце", 15, ""), "bear": ("🧸", "Мишка", 15, ""), "balloon": ("🎈", "Шарик", 20, ""), "star": ("⭐", "Звезда", 25, ""),
    "box": ("🎁", "Подарок", 25, ""), "rose": ("🌹", "Роза", 25, ""), "lollipop": ("🍭", "Леденец", 30, ""), "cupcake": ("🧁", "Капкейк", 40, ""),
    "cake": ("🎂", "Торт", 50, ""), "bouquet": ("💐", "Букет", 50, ""), "rocket": ("🚀", "Ракета", 50, ""), "wine": ("🍾", "Шампанское", 50, ""),
    "mug": ("☕", "Какао", 60, ""), "clover": ("🍀", "Клевер", 75, ""), "snowman": ("⛄", "Снеговик", 80, ""), "cup": ("🏆", "Кубок", 100, ""),
    "ring": ("💍", "Кольцо", 100, ""), "gem": ("💎", "Самоцвет", 100, ""), "crown": ("👑", "Корона", 250, ""),
}
# NFT-коллекции: id → (значок для бота, название, тираж, цена покупки, базовая цена улучшения)
COLLS = {
    "elixir": ("🧪", "Эликсир", 2500, 1000, 250), "key": ("🗝️", "Золотой ключ", 3000, 900, 220), "moon": ("🌙", "Лунный серп", 2000, 1400, 330),
    "planet": ("🪐", "Кольцевая планета", 2200, 1200, 300), "ufo": ("🛸", "Тарелка пришельцев", 1500, 1500, 350), "chalice": ("🏆", "Кубок судьбы", 1200, 1800, 420),
    "orb": ("🔮", "Звёздный шар", 800, 2500, 560), "diamond": ("💎", "Бриллиант", 800, 2600, 580), "lamp": ("🪔", "Лампа джинна", 700, 3000, 650),
    "dragon": ("🐉", "Огненный дракон", 500, 4000, 900), "crown": ("👑", "Королевская корона", 300, 6500, 1400), "dice": ("🎲", "Счастливый кубик", 100, 15000, 3000),
}
# старые коллекции (до обновления) показываются как новые: коллекционные подарки у людей не пропадают
COLL_ALIAS = {"bear": "orb", "rose": "elixir", "cup": "chalice", "rocket": "ufo", "gem": "diamond"}
MAX_TIER = 3
TIER_NAMES = ["Стандартный", "Улучшенный", "Мастерский", "Совершенный"]
# модели: название, ключ окраски на клиенте, редкость (в промилле)
MODELS = [("Классика", "classic", 280), ("Золотой", "gold", 200), ("Ледяной", "ice", 160), ("Обсидиан", "obsidian", 130),
          ("Неоновый", "neon", 100), ("Королевский", "royal", 70), ("Призрачный", "ghost", 40), ("Космический", "cosmic", 20)]
BACKDROPS = [("Небесный", "#7ec8ff", "#2f7bff", 150), ("Малина", "#ff8fb1", "#d6336c", 150), ("Мята", "#8ff0d0", "#12b886", 140), ("Янтарь", "#ffd27a", "#f08c00", 130),
             ("Лаванда", "#c9b5ff", "#7048e8", 120), ("Графит", "#9aa3b2", "#343a46", 100), ("Рубин", "#ff7a7a", "#c92a2a", 80), ("Изумруд", "#69db7c", "#2b8a3e", 70),
             ("Закат", "#ffa8a8", "#f76707", 35), ("Северное сияние", "#63e6be", "#4263eb", 15), ("Чёрный бриллиант", "#6b7280", "#05060a", 5)]
# узоры: название, ключ рисунка на клиенте, редкость
PATTERNS = [("Звёзды", "star", 220), ("Сердца", "heart", 180), ("Искры", "spark", 180), ("Снежинки", "snow", 140), ("Цветы", "flower", 120), ("Молнии", "bolt", 90),
            ("Кубики", "cube", 50), ("Короны", "crown", 20)]
PREMIUM_GIFT = {3: (1400, 90), 6: (2600, 180), 12: (4990, 365)}          # месяцы → (цена, дней)
GIFT_SELL_DAYS = 7                                                       # окно продажи обычного подарка обратно за звёзды
GIFT_SELL_RATE = 0.5                                                     # доля исходной цены, которую возвращают при продаже
GIFT_RARE.update(k for k, v in GIFTS.items() if v[2] >= 75)            # «редкие» (для настроек приватности): дорогие обычные подарки
# редкость по вероятности сочетания «модель × фон × узор» (с поправкой на улучшения)
RARITY_STEPS = [(0.00016, "myth", "Мифический"), (0.00045, "legend", "Легендарный"), (0.00105, "epic", "Эпический"), (0.0027, "rare", "Редкий")]


def coll_of(c):
    return COLL_ALIAS.get(c, c)


def pick_w(table, idx_w=3):
    tot = sum(x[idx_w] for x in table)
    r = random.uniform(0, tot)
    acc = 0
    for i, x in enumerate(table):
        acc += x[idx_w]
        if r <= acc:
            return i
    return len(table) - 1


def combo_prob(mi, bi, pi_):
    mo, bd, pt = MODELS[mi % len(MODELS)], BACKDROPS[bi % len(BACKDROPS)], PATTERNS[pi_ % len(PATTERNS)]
    return (mo[2] / sum(x[2] for x in MODELS)) * (bd[3] / sum(x[3] for x in BACKDROPS)) * (pt[2] / sum(x[2] for x in PATTERNS))


def nft_rarity(g):
    p = combo_prob(g["model"], g["backdrop"], g["pattern"]) / (1.8 ** (g.get("tier") or 0))
    for th, k, n in RARITY_STEPS:
        if p < th:
            return {"k": k, "n": n}
    return {"k": "common", "n": "Обычный"}


def up_price(coll, tier):
    """Цена улучшения NFT с уровня tier на следующий: базовая × 1, 2, 4."""
    return COLLS[coll_of(coll)][4] * (2 ** tier)


def reroll(g, tier_new):
    """Новая модель/фон/узор при улучшении: чем выше уровень, тем ровнее шансы (редкое выпадает чаще), и результат всегда редче прежнего."""
    cur = (g["model"], g["backdrop"], g["pattern"])
    p_old = combo_prob(*cur)
    ex = max(0.0, 1.0 - 0.4 * tier_new)

    def pick(table, idx):
        return random.choices(range(len(table)), [x[idx] ** ex for x in table])[0]
    best = None
    for _ in range(80):
        c = (pick(MODELS, 2), pick(BACKDROPS, 3), pick(PATTERNS, 2))
        p = combo_prob(*c)
        if p < p_old * 0.8:
            return c
        if best is None or p < combo_prob(*best):
            best = c
    if combo_prob(*best) >= p_old:
        # крайний случай: подставляем самое редкое значение одного из признаков
        for idx, tbl, w in ((0, MODELS, 2), (2, PATTERNS, 2), (1, BACKDROPS, 3)):
            c = list(cur)
            c[idx] = min(range(len(tbl)), key=lambda i: tbl[i][w])
            if combo_prob(*c) < p_old:
                return tuple(c)
    return best


def _minted():
    now = time.time()
    c = _minted.cache
    if now - c[0] > 4:
        c[1] = {r["coll"]: r["minted"] for r in qa("SELECT coll, minted FROM coll_mint")}
        c[0] = now
    return c[1]


_minted.cache = [0, {}]


def attrs_out(g):
    """Описание NFT-подарка для клиента: коллекция, номер, тираж, модель, фон, узор, их редкость, уровень улучшения."""
    if not g.get("coll"):
        return None
    coll = coll_of(g["coll"])
    if coll not in COLLS:
        return None
    em, name, supply, price, _ = COLLS[coll]
    mo, bd, pt = MODELS[g["model"] % len(MODELS)], BACKDROPS[g["backdrop"] % len(BACKDROPS)], PATTERNS[g["pattern"] % len(PATTERNS)]
    tier = int(g.get("tier") or 0)
    return {"coll": coll, "e": em, "name": name, "num": g["num"], "supply": supply, "minted": _minted().get(coll, 0),
            "model": {"n": mo[0], "k": mo[1], "r": round(mo[2] / sum(x[2] for x in MODELS) * 100, 1)},
            "backdrop": {"n": bd[0], "c1": bd[1], "c2": bd[2], "r": round(bd[3] / sum(x[3] for x in BACKDROPS) * 100, 1)},
            "pattern": {"n": pt[0], "k": pt[1], "e": pt[1], "r": round(pt[2] / sum(x[2] for x in PATTERNS) * 100, 1)},
            "tier": tier, "tier_n": TIER_NAMES[min(tier, MAX_TIER)], "rarity": nft_rarity(g)}


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
        d.update(e=e, name=n, up=0, kind="reg")
    a = attrs_out(g)
    if a:
        d["nft"] = a
        d["name"] = a["name"]
        d["e"] = a["e"]
        d["kind"] = "nft"
        if viewer == g["to_id"] and a["tier"] < MAX_TIER:
            d["up"] = up_price(g["coll"], a["tier"])           # цена следующего улучшения; у обычных подарков улучшения нет
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
    return {"coll": coll, "num": n, "model": pick_w(MODELS, 2), "backdrop": pick_w(BACKDROPS), "pattern": pick_w(PATTERNS, 2)}


@app.get("/api/gifts/catalog")
def gifts_catalog():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    mints = {r["coll"]: r["minted"] for r in qa("SELECT coll, minted FROM coll_mint")}
    reg = [{"key": k, "name": v[1], "price": v[2], "rare": 1 if k in GIFT_RARE else 0} for k, v in GIFTS.items()]
    sm, sb, sp = sum(x[2] for x in MODELS), sum(x[3] for x in BACKDROPS), sum(x[2] for x in PATTERNS)
    col = [{"coll": k, "name": v[1], "supply": v[2], "minted": mints.get(k, 0), "price": v[3], "left": v[2] - mints.get(k, 0), "up": v[4],
            "models": [{"n": m[0], "k": m[1], "r": round(m[2] / sm * 100, 1)} for m in MODELS],
            "backdrops": [{"n": b[0], "c1": b[1], "c2": b[2], "r": round(b[3] / sb * 100, 1)} for b in BACKDROPS],
            "patterns": [{"n": p[0], "k": p[1], "r": round(p[2] / sp * 100, 1)} for p in PATTERNS]} for k, v in COLLS.items()]
    prem = [{"months": m, "price": v[0], "days": v[1]} for m, v in PREMIUM_GIFT.items()]
    return jsonify(ok=True, regular=reg, collectibles=col, nft=col, premium=prem, balance=u.get("stars") or 0, my_premium=is_premium(u),
                   tiers={"max": MAX_TIER, "names": TIER_NAMES})


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
        if receiver == sender and not anon:        # подарок себе приходит в «Избранное» уже прочитанным
            run("UPDATE messages SET is_read=1 WHERE id=?", (mid,))
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
    chan = None                                        # подарок каналу: to = -id канала. Группам подарки не отправляются
    try:
        raw_to = int(d.get("to"))
    except (TypeError, ValueError):
        raw_to = 0
    if raw_to < 0:
        chan = chat_row(-raw_to)
        if not chan or chan["kind"] != "channel" or is_hc(chan["id"]):
            return err("Подарки можно отправлять людям, в каналы и себе — не в группы")
        if not chan["slug"] and not member_row(chan["id"], u["id"]):
            return err("Нет доступа к этому каналу", 403)
        if q1("SELECT 1 FROM chat_bans WHERE chat_id=? AND user_id=?", (chan["id"], u["id"])):
            return err("Вы заблокированы в этом канале", 403)
        to, t = raw_to, {"id": raw_to, "is_system": 0}
    else:
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
    gg = None if chan else gift_gate(u, t, key)
    if gg:
        return err(gg, 403)
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
        star_tx(u["id"], -price, f"Подарок: {name}" + (" (себе)" if to == u["id"] else f" (каналу «{chan['title']}»)" if chan else ""), "gift")
        gid = run("""INSERT INTO gifts(from_id,to_id,key,coll,model,backdrop,pattern,num,anon,msg,price,ts,shown) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)""",
                  (u["id"], to, coll and ("c:" + coll) or key, a["coll"], a["model"], a["backdrop"], a["pattern"], a["num"], anon, msg, price, now)).lastrowid
    g = q1("SELECT * FROM gifts WHERE id=?", (gid,))
    if chan:                                                   # в канале никаких сообщений-объявлений: подарок виден во вкладке «Подарки» профиля канала
        push_chat_update(chan)
    else:
        gift_message(u["id"], to, g, f"🎁 Подарок: {name}")
        notify_profile(to)
    return jsonify(ok=True, gift=gift_out(g, u["id"]), user=public(fresh(u["id"]), True))


@app.get("/api/gifts/chat/<int:cid>")
def gifts_chat(cid):
    """Подарки канала — вкладка «Подарки» в профиле канала."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    ch = chat_row(cid)
    if not ch or ch["kind"] != "channel" or (not ch["slug"] and not member_row(cid, u["id"])):
        return err("Не найдено", 404)
    rows = qa("SELECT * FROM gifts WHERE to_id=? AND key NOT LIKE 'prem:%' AND sold=0 AND shown=1 ORDER BY pin DESC, id DESC LIMIT 300", (-cid,))
    return jsonify(ok=True, gifts=[gift_out(g, u["id"]) for g in rows], total=len(rows))


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
    o = q1("SELECT * FROM users WHERE id=?", (g["to_id"],)) if g["to_id"] > 0 else None
    if o:
        d["owner"] = {"id": o["id"], "name": o["name"], "surname": o.get("surname") or "", "avatar": o.get("avatar") or ""}
    elif g["to_id"] < 0:
        oc = chat_row(-g["to_id"])
        if oc:
            d["owner"] = {"id": -oc["id"], "name": oc["title"], "surname": "", "avatar": oc["photo"] or "", "chan": 1}
    return jsonify(ok=True, gift=d)


@app.post("/api/gift/upgrade")
def gift_upgrade():
    """Владелец NFT-подарка улучшает его: модель, фон и узор выпадают заново и всегда оказываются редче прежних (номер сохраняется).
    Обычные подарки улучшить нельзя. Цена растёт с каждым уровнем; всего {MAX_TIER} улучшения."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    gid = num(body().get("id"), 1, 2 ** 62) or 0
    g = q1("SELECT * FROM gifts WHERE id=? AND to_id=?", (gid, u["id"]))
    if not g:
        return err("Подарок не найден", 404)
    if not g["coll"] or coll_of(g["coll"]) not in COLLS:
        return err("Улучшать можно только NFT-подарки")
    tier = int(g.get("tier") or 0)
    if tier >= MAX_TIER:
        return err("Подарок уже улучшен до максимума")
    price = up_price(g["coll"], tier)
    prev = attrs_out(g)
    with db_lock:
        cur = fresh(u["id"])
        if (cur.get("stars") or 0) < price:
            return jsonify(ok=False, error=f"Недостаточно звёзд: нужно {price}, у вас {cur.get('stars') or 0}", need=price), 402
        g = q1("SELECT * FROM gifts WHERE id=? AND to_id=?", (gid, u["id"]))
        if int(g.get("tier") or 0) != tier:
            return err("Подарок уже улучшен")
        mi, bi, pi_ = reroll(g, tier + 1)
        run("UPDATE users SET stars=stars-? WHERE id=?", (price, u["id"]))
        star_tx(u["id"], -price, f"Улучшение NFT: {COLLS[coll_of(g['coll'])][1]} №{g['num']}", "gift")
        run("UPDATE gifts SET model=?, backdrop=?, pattern=?, tier=?, price=price+? WHERE id=?", (mi, bi, pi_, tier + 1, price, gid))
    g = q1("SELECT * FROM gifts WHERE id=?", (gid,))
    notify_profile(u["id"])
    return jsonify(ok=True, gift=gift_out(g, u["id"]), prev=prev, user=public(fresh(u["id"]), True))


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
    gg = gift_gate(u, t, "prem:" + str(months))
    if gg:
        return err(gg, 403)
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
    if q1("""SELECT 1 FROM unames n JOIN users u ON u.id=n.uid WHERE n.name=? COLLATE NOCASE AND n.uid!=?
             AND COALESCE(u.deleted,0)=0""", (name, skip_user)):
        return True
    return bool(q1("SELECT 1 FROM chats WHERE slug=? COLLATE NOCASE AND id!=?", (name, skip_chat)))


def name_reserved(name, u):
    """«owner», «admin» и т. п. занимать может только владелец сервиса."""
    n = name.lower()
    if n == "owner":
        return not is_admin(u)
    return n in RESERVED


# ── сведения о ссылке для встроенного браузера: можно ли показать страницу внутри приложения + заголовок/описание/картинка ──
import socket, ssl, html as _html
import http.client as _httpc      # именно так: «import http.client» затёр бы глобальное имя http (сессию requests) и сломал отправку в Telegram
from urllib.parse import urljoin
LINKINFO_ALLOW_PRIVATE = os.environ.get("LINKINFO_ALLOW_PRIVATE", "0") == "1"      # только для тестов: разрешает адреса внутренней сети
_linkinfo_cache = {}


class _PinnedConn:
    """Соединение строго с заранее проверенным IP (защита от подмены DNS): адрес проверен как публичный, подключаемся именно к нему."""
    @staticmethod
    def make(scheme, host, port, ip, timeout):
        base = _httpc.HTTPSConnection if scheme == "https" else _httpc.HTTPConnection

        class C(base):
            def connect(self_):
                sock = socket.create_connection((ip, port), timeout)
                if scheme == "https":
                    self_.sock = ssl.create_default_context().wrap_socket(sock, server_hostname=host)
                else:
                    self_.sock = sock
        return C(host, port, timeout=timeout)


def _frame_allowed(headers):
    """Разрешает ли сайт показ внутри чужой страницы (X-Frame-Options / CSP frame-ancestors)."""
    xfo = (headers.get("x-frame-options") or "").lower()
    if xfo and "allowall" not in xfo:
        return False
    csp = headers.get("content-security-policy") or ""
    for part in csp.split(";"):
        part = part.strip().lower()
        if part.startswith("frame-ancestors"):
            vals = part.split()[1:]
            host = urlparse(PUBLIC_BASE).hostname or ""
            ok = "*" in vals or any(host and host in v for v in vals) or any(v in ("https:", "http:") for v in vals)
            return bool(ok) and "'none'" not in vals
    return True


def _meta_of(doc, final_url):
    def pick(*names):
        for n in names:
            for pat in (r'<meta[^>]+(?:property|name)=["\']%s["\'][^>]*content=["\']([^"\']*)["\']' % re.escape(n),
                        r'<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']%s["\']' % re.escape(n)):
                m = re.search(pat, doc, re.I)
                if m and m.group(1).strip():
                    return _html.unescape(m.group(1)).strip()
        return ""
    title = pick("og:title", "twitter:title")
    if not title:
        m = re.search(r"<title[^>]*>(.*?)</title>", doc, re.I | re.S)
        title = _html.unescape(re.sub(r"\s+", " ", m.group(1))).strip() if m else ""
    img = pick("og:image", "twitter:image")
    if img:
        img = urljoin(final_url, img)
        if not re.match(r"^https?://", img, re.I):
            img = ""
    return {"title": title[:140], "desc": pick("og:description", "description", "twitter:description")[:260], "image": img[:500], "site": pick("og:site_name")[:60]}


def fetch_linkinfo(url):
    cur, hops = url, 0
    while hops < 4:
        u = urlparse(cur)
        if u.scheme not in ("http", "https") or not u.hostname:
            return None
        port = u.port or (443 if u.scheme == "https" else 80)
        if not LINKINFO_ALLOW_PRIVATE and port not in (80, 443):
            return None
        try:
            ips = [i[4][0] for i in socket.getaddrinfo(u.hostname, port, type=socket.SOCK_STREAM)]
        except OSError:
            return {"frame": True, "unreachable": True, "url": cur}
        if not ips or (not LINKINFO_ALLOW_PRIVATE and not all(_public_ip(ip) for ip in ips)):
            return None
        conn = _PinnedConn.make(u.scheme, u.hostname, port, ips[0], 4.5)
        try:
            path = (u.path or "/") + ("?" + u.query if u.query else "")
            hostH = u.hostname + (":%d" % u.port if u.port else "")
            conn.request("GET", path, headers={"Host": hostH, "User-Agent": "Mozilla/5.0 (compatible; DicegramLinkBot/1.0)", "Accept": "text/html,*/*;q=0.5",
                                              "Accept-Encoding": "identity", "Accept-Language": "ru,en;q=0.8"})
            r = conn.getresponse()
            h = {k.lower(): v for k, v in r.getheaders()}
            if r.status in (301, 302, 303, 307, 308) and h.get("location"):
                cur = urljoin(cur, h["location"]); hops += 1
                continue
            out = {"url": cur, "frame": _frame_allowed(h), "status": r.status}
            if "text/html" in (h.get("content-type") or "").lower():
                raw = r.read(262144)
                cs = re.search(r"charset=([\w-]+)", h.get("content-type") or "", re.I) or re.search(rb'<meta[^>]+charset=["\']?([\w-]+)', raw[:4096], re.I)
                enc = (cs.group(1).decode() if cs and isinstance(cs.group(1), bytes) else cs.group(1) if cs else "utf-8")
                try:
                    doc = raw.decode(enc, "replace")
                except LookupError:
                    doc = raw.decode("utf-8", "replace")
                out.update(_meta_of(doc, cur))
            return out
        except (OSError, _httpc.HTTPException, ssl.SSLError):
            return {"frame": True, "unreachable": True, "url": cur}
        finally:
            try:
                conn.close()
            except Exception:
                pass
    return None


@app.get("/api/linkinfo")
def linkinfo():
    """?url=… → {frame, title, desc, image, site, url}. frame=false — сайт запрещает показ внутри приложения (откроем во внешнем браузере)."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    url = str(request.args.get("url") or "").strip()[:2000]
    if not re.match(r"^https?://", url, re.I):
        return err("Неверная ссылка")
    if not hit("linkinfo", u["id"], 30, 60):
        return err("Слишком часто", 429)
    now = time.time()
    c = _linkinfo_cache.get(url)
    if c and now - c[0] < 600:
        return jsonify(ok=True, info=c[1])
    info = fetch_linkinfo(url)
    if info is None:
        return err("Эту ссылку нельзя проверить", 400)
    if len(_linkinfo_cache) > 500:
        for k in sorted(_linkinfo_cache, key=lambda k: _linkinfo_cache[k][0])[:100]:
            _linkinfo_cache.pop(k, None)
    _linkinfo_cache[url] = (now, info)
    return jsonify(ok=True, info=info)


@app.get("/api/resolve/<name>")
def resolve_name(name):
    """Кто или что скрывается за @именем: человек, группа или канал (для нажатий на @упоминания)."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    name = str(name or "").strip().lstrip("@")
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{2,31}", name):
        return err("Не найдено", 404)
    t = user_by_name(name)
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
CLICKER_TPS = 12               # устойчивая скорость тапов в секунду (человек — до ~9–10)
CLICKER_BURST = 30             # запас «токенов»: короткий всплеск тапов не режется
CLICKER_BATCH_MAX = 40         # сколько тапов клиент может прислать одним пакетом
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
    # весь «прочитал → начислил» под одной блокировкой: два параллельных запроса не начислят
    # пассивный доход дважды за один и тот же промежуток времени
    with db_lock:
        row = q1("SELECT * FROM game_wallet WHERE user_id=?", (uid,))
        now = int(time.time())
        if not row:
            run("INSERT OR IGNORE INTO game_wallet(user_id, passive_ts) VALUES(?,?)", (uid, now))
            return q1("SELECT * FROM game_wallet WHERE user_id=?", (uid,))
        # лениво начисляем пассивный доход с момента последнего посещения (а не по таймеру на сервере —
        # так дешевле и не нужен фоновый планировщик для каждого игрока)
        elapsed = max(0, min(now - (row["passive_ts"] or now), PASSIVE_MAX_ACCRUE))
        gained = elapsed * (row["passive_level"] or 0)
        if gained > 0:
            run("UPDATE game_wallet SET coins=coins+?, passive_ts=? WHERE user_id=?", (gained, now, uid))
            return q1("SELECT * FROM game_wallet WHERE user_id=?", (uid,))
        if not row["passive_ts"] or not row["passive_level"]:
            # нет пассивного дохода — просто двигаем метку времени, чтобы будущие уровни
            # не начислили «задним числом» за все дни простоя
            run("UPDATE game_wallet SET passive_ts=? WHERE user_id=?", (now, uid))
            row["passive_ts"] = now
        return row


_click_bucket = {}   # uid -> (токены, время) — токен-бакет скорости тапов


def click_allow(uid, n):
    """Сколько из n тапов в пакете засчитываем: человек физически не тапает быстрее CLICKER_TPS."""
    now = time.monotonic()
    with _rl_lock:
        tokens, ts = _click_bucket.get(uid, (float(CLICKER_BURST), now))
        tokens = min(float(CLICKER_BURST), tokens + (now - ts) * CLICKER_TPS)
        take = max(0, min(n, int(tokens)))
        _click_bucket[uid] = (tokens - take, now)
        if len(_click_bucket) > 4000:       # не растём бесконечно: выкидываем давно «полные» бакеты
            for k in [k for k, (_t, _ts) in _click_bucket.items() if now - _ts > 60][:2000]:
                _click_bucket.pop(k, None)
        return take


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
    """Принимает ПАКЕТ тапов (n) — клиент копит тапы и шлёт раз в ~0.4 с, поэтому быстрые тапы не теряются.
    Сервер сам ограничивает скорость (токен-бакет) и обрывает пакет на тапе, после которого нужна капча."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    n = num(body().get("n", 1), 1, 100_000)
    n = min(n or 1, CLICKER_BATCH_MAX)
    with db_lock:
        w = wallet_row(u["id"])
        if w["captcha"]:
            return jsonify(ok=False, need_captcha=True, captcha=w["captcha"], error="Сначала решите проверку")
        allowed = click_allow(u["id"], n)
        if allowed <= 0:
            return jsonify(ok=True, accepted=0, throttled=True, coins=w["coins"], need_captcha=False, captcha=None)
        power = w["click_power"] or 0
        streak = w["streak"] or 0
        room = max(1, CLICKER_CAPTCHA_EVERY - streak)      # сколько тапов осталось до проверки «не бот»
        take = min(allowed, room)
        need_captcha = take >= room
        gain = take * (1 + power)
        run("UPDATE game_wallet SET coins=coins+?, streak=? WHERE user_id=?", (gain, 0 if need_captcha else streak + take, u["id"]))
        run("""INSERT INTO game_scores(user_id,game,day,score,ts) VALUES(?,?,?,?,?)
               ON CONFLICT(user_id,game,day) DO UPDATE SET score=score+excluded.score, ts=excluded.ts""",
            (u["id"], "clicker", today_str(), gain, int(time.time())))
        q = new_captcha(u["id"]) if need_captcha else None
        w2 = wallet_row(u["id"])
        td = q1("SELECT score FROM game_scores WHERE user_id=? AND game='clicker' AND day=?", (u["id"], today_str()))
    return jsonify(ok=True, coins=w2["coins"], today=td["score"] if td else 0, gain=gain, accepted=take,
                   throttled=take < n, need_captcha=need_captcha, captcha=q)


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
    field = "click_power" if kind == "click" else "passive_level"
    base, growth = (UPGRADE_CLICK_BASE, UPGRADE_CLICK_GROWTH) if kind == "click" else (UPGRADE_PASSIVE_BASE, UPGRADE_PASSIVE_GROWTH)
    with db_lock:        # проверка баланса и списание — одной транзакцией: двойной тап не уведёт баланс в минус
        w = wallet_row(u["id"])
        if w["captcha"]:
            return jsonify(ok=False, need_captcha=True, captcha=w["captcha"], error="Сначала решите проверку")
        level = w[field] or 0
        if level >= UPGRADE_MAX_LEVEL:
            return err("Это улучшение уже максимального уровня")
        cost = upgrade_cost(level, base, growth)
        if (w["coins"] or 0) < cost:
            return err("Недостаточно монет")
        # field — всегда одна из двух фиксированных констант выше, никогда не приходит от клиента напрямую
        run(f"UPDATE game_wallet SET coins=coins-?, {field}={field}+1 WHERE user_id=? AND {field}=? AND coins>=?", (cost, u["id"], level, cost))
        w2 = wallet_row(u["id"])
    new_level = w2[field] or 0
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




# ═══════════════════════════════════════════════════════════════════════════════════════
#  DICEBOT · БОТЫ · BOT API (названия методов и формат ответов — как у Telegram Bot API)
# ═══════════════════════════════════════════════════════════════════════════════════════
import queue, mimetypes
from html.parser import HTMLParser as _HTMLParser

BOT_ABOUT_MAX = 200                                                   # длина «О боте»
BOT_LIMIT = min(20, max(1, env_int("BOT_MAX_PER_USER", 20)))                  # сколько ботов может создать один человек
DICEBOT_NUMBER, DICEBOT_NAME, DICEBOT_USER = "+42779", "Dicebot", "Dicebot"
BOT_UPD_MAX = 3000                                                   # необработанных обновлений на бота
BOT_UPD_TTL = 24 * 3600                                              # и сколько они хранятся
BOT_BAD_PREFIX = ("dicegram", "dicebot", "telegram", "botfather", "official", "support", "admin", "owner")
BOT_BAD_NAMES = {"dicegram", "dicebot", "telegram", "botfather", "dicegram support", "support", "official"}
BOT_FILE_MAX = MAX_UPLOAD
BOT_CMD_RE = re.compile(r"^[a-z0-9_]{1,32}$")
bot_cond = threading.Condition()                                     # будит getUpdates, когда пришло обновление
_gu_active, _gu_lock = {}, threading.Lock()                          # bot_id -> идёт getUpdates (одновременно — только один)
_bot_seen = {}                                                       # bot_id -> когда последний раз обращался к API
_pcq = {}                                                            # pre_checkout_query id -> ожидание ответа бота
_hook_busy, _hook_q, _hook_retry, _hook_lock = set(), queue.Queue(), {}, threading.Lock()
_dicebot_cache = [0]
HOOK_ALLOW_PRIVATE = os.environ.get("HOOK_ALLOW_PRIVATE", "0") == "1"   # только для тестов: адреса внутренней сети


class BotErr(Exception):
    def __init__(self, code, desc, params=None):
        super().__init__(desc)
        self.code, self.desc, self.params = code, desc, params


def bots_schema(db):
    db.executescript("""
    CREATE TABLE IF NOT EXISTS bots(
        id INTEGER PRIMARY KEY, owner INTEGER NOT NULL, tok_hash TEXT NOT NULL, tok_enc TEXT NOT NULL, tok_ts INTEGER DEFAULT 0,
        descr TEXT DEFAULT '', about TEXT DEFAULT '', cmds TEXT DEFAULT '[]', menu_kb TEXT DEFAULT '',
        enabled INTEGER DEFAULT 1, groups_ok INTEGER DEFAULT 1, privacy INTEGER DEFAULT 1,
        hook_url TEXT DEFAULT '', hook_secret TEXT DEFAULT '', hook_ts INTEGER DEFAULT 0, hook_err TEXT DEFAULT '', hook_err_ts INTEGER DEFAULT 0,
        msgs_in INTEGER DEFAULT 0, msgs_out INTEGER DEFAULT 0, stars_in INTEGER DEFAULT 0, created INTEGER, last_api INTEGER DEFAULT 0);
    CREATE INDEX IF NOT EXISTS ix_bots_owner ON bots(owner);
    UPDATE bots SET about=substr(descr,1,200) WHERE COALESCE(about,'')='' AND COALESCE(descr,'')<>'';
    UPDATE bots SET descr='' WHERE COALESCE(descr,'')<>'';
    CREATE TABLE IF NOT EXISTS bot_admins(bot_id INTEGER, uid INTEGER, ts INTEGER, PRIMARY KEY(bot_id, uid));
    CREATE INDEX IF NOT EXISTS ix_bot_admins_uid ON bot_admins(uid);
    CREATE TABLE IF NOT EXISTS bot_users(bot_id INTEGER, uid INTEGER, first INTEGER, last INTEGER, msgs INTEGER DEFAULT 0,
        blocked INTEGER DEFAULT 0, PRIMARY KEY(bot_id, uid));
    CREATE TABLE IF NOT EXISTS bot_updates(id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id INTEGER NOT NULL, data TEXT, ts INTEGER,
        tries INTEGER DEFAULT 0);
    CREATE INDEX IF NOT EXISTS ix_bot_upd ON bot_updates(bot_id, id);
    CREATE TABLE IF NOT EXISTS bot_cbq(id TEXT PRIMARY KEY, bot_id INTEGER, uid INTEGER, mid INTEGER, ts INTEGER);
    CREATE TABLE IF NOT EXISTS bot_pay(id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id INTEGER, uid INTEGER, mid INTEGER, amount INTEGER,
        title TEXT DEFAULT '', payload TEXT DEFAULT '', charge TEXT DEFAULT '', ts INTEGER, status TEXT DEFAULT 'paid');
    CREATE INDEX IF NOT EXISTS ix_bot_pay ON bot_pay(bot_id, id);
    CREATE TABLE IF NOT EXISTS bot_out(id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id INTEGER, uid INTEGER, amount INTEGER, key TEXT, ref TEXT, ts INTEGER,
        UNIQUE(bot_id, key));
    """)
    if "bot" not in {r["name"] for r in db.execute("PRAGMA table_info(users)")}:
        db.execute("ALTER TABLE users ADD COLUMN bot INTEGER DEFAULT 0")


# ───────────── токены ─────────────
def bot_make_token(bid):
    secret = "AA" + secrets.token_urlsafe(30)
    return f"{bid}:{secret}", hashlib.sha256(secret.encode()).hexdigest()


def bot_row(bid):
    return q1("SELECT * FROM bots WHERE id=?", (bid,)) if bid else None


def bot_token_of(b):
    try:
        return decrypt_text(b["tok_enc"])
    except Exception:
        return ""


def bot_auth(token):
    """token «id:секрет» → (bots-строка, users-строка) или None."""
    try:
        bid_s, sec = str(token).split(":", 1)
        bid = int(bid_s)
    except (ValueError, AttributeError):
        return None
    b = bot_row(bid)
    if not b or not sec:
        return None
    if not hmac.compare_digest(hashlib.sha256(sec.encode()).hexdigest(), b["tok_hash"]):
        return None
    u = fresh(bid)
    if not u or u.get("deleted") or u.get("banned"):
        return None
    return b, u


def bot_cmds(b):
    try:
        v = json.loads(b.get("cmds") or "[]")
    except Exception:
        v = []
    return [c for c in v if isinstance(c, dict) and c.get("command")][:100]


def bot_alive(b):
    """Бот сейчас «на связи»: подключён webhook или недавно был запрос getUpdates."""
    return bool(b.get("hook_url")) or time.time() - _bot_seen.get(b["id"], 0) < 90


def tg_user(u):
    d = {"id": u["id"], "is_bot": bool(u.get("bot")), "first_name": u.get("name") or "User"}
    if u.get("surname"):
        d["last_name"] = u["surname"]
    if u.get("username"):
        d["username"] = u["username"]
    if is_premium(u):
        d["is_premium"] = True
    return d


def tg_chat_user(u):
    d = {"id": u["id"], "type": "private", "first_name": u.get("name") or "User"}
    if u.get("surname"):
        d["last_name"] = u["surname"]
    if u.get("username"):
        d["username"] = u["username"]
    return d


def tg_chat_group(ch):
    d = {"id": -ch["id"], "type": "channel" if ch["kind"] == "channel" else "supergroup", "title": ch["title"] or ""}
    if ch.get("slug"):
        d["username"] = ch["slug"]
    return d


_T2O = {"bold": "b", "italic": "i", "underline": "u", "strikethrough": "s", "code": "c", "pre": "c", "spoiler": "sp",
        "blockquote": "q", "expandable_blockquote": "q"}
_O2T = {"b": "bold", "i": "italic", "u": "underline", "s": "strikethrough", "c": "code", "sp": "spoiler", "q": "blockquote"}


def tg_entities(text, ents):
    out = []
    for e in ents or []:
        t = _O2T.get(e.get("t"))
        if t:
            out.append({"type": t, "offset": e["o"], "length": e["l"]})
        elif e.get("t") == "a" and e.get("u"):
            out.append({"type": "text_link", "offset": e["o"], "length": e["l"], "url": e["u"]})
    if text:
        m = re.match(r"^/[A-Za-z0-9_]{1,32}(@[A-Za-z0-9_]{3,32})?", text)
        if m:
            out.append({"type": "bot_command", "offset": 0, "length": utf16len(m.group(0))})
        for m in re.finditer(r"(?<![\w@])@[A-Za-z][A-Za-z0-9_]{4,31}", text):
            out.append({"type": "mention", "offset": utf16len(text[:m.start()]), "length": utf16len(m.group(0))})
    return out


def tg_file_obj(att, kind):
    fid = att.get("fid") or ""
    d = {"file_id": fid, "file_unique_id": fid[:16], "file_size": att.get("size") or 0}
    if kind == "photo":
        d.update(width=att.get("w") or 0, height=att.get("h") or 0)
    elif kind in ("voice", "gif"):
        d["duration"] = int((att.get("dur") or 0) / 1000)
        d["mime_type"] = att.get("mime") or ""
    else:
        d["file_name"] = att.get("name") or ""
        d["mime_type"] = att.get("mime") or ""
    return d


def tg_message(row, bot_id=0, depth=0):
    """Строка messages → объект Message в формате Telegram."""
    meta = meta_load(row["meta"])
    text = decrypt_text(row["text"])
    sender = fresh(row["sender"]) or {"id": row["sender"], "name": "?"}
    m = {"message_id": row["id"], "from": tg_user(sender), "date": row["ts"]}
    if row["receiver"] < 0:
        ch = chat_row(-row["receiver"])
        m["chat"] = tg_chat_group(ch) if ch else {"id": row["receiver"], "type": "supergroup", "title": ""}
        if row.get("topic"):
            m["message_thread_id"] = row["topic"]
    else:
        human = row["receiver"] if row["sender"] == bot_id else row["sender"]
        m["chat"] = tg_chat_user(fresh(human) or {"id": human, "name": "?"})
    kind = row.get("kind") or "text"
    att = meta.get("a") or {}
    ents = tg_entities(text, meta.get("e"))
    if kind == "text":
        m["text"] = text
        if ents:
            m["entities"] = ents
    else:
        if text:
            m["caption"] = text
            if ents:
                m["caption_entities"] = ents
        if kind == "photo":
            m["photo"] = [tg_file_obj(att, "photo")]
        elif kind == "voice":
            m["voice"] = tg_file_obj(att, "voice")
        elif kind == "gif":
            m["animation"] = tg_file_obj(att, "gif")
        elif kind == "sticker":
            m["sticker"] = {"file_id": att.get("fid") or att.get("b") or "", "file_unique_id": (att.get("fid") or att.get("b") or "")[:16],
                            "type": "regular", "emoji": att.get("em") or "", "width": att.get("w") or 0, "height": att.get("h") or 0}
        else:
            m["document"] = tg_file_obj(att, "file")
    if row.get("reply_to") and depth == 0:
        rr = q1("SELECT * FROM messages WHERE id=?", (row["reply_to"],))
        if rr:
            m["reply_to_message"] = tg_message(rr, bot_id, 1)
    inv = meta.get("inv")
    if inv:
        m["invoice"] = {"title": inv.get("t", ""), "description": inv.get("d", ""), "currency": "XTR", "total_amount": inv.get("a", 0),
                        "start_parameter": ""}
    if meta.get("edit"):
        m["edit_date"] = meta["edit"]
    return m


# ───────────── разбор форматирования (parse_mode) ─────────────
class _FmtHTML(_HTMLParser):
    TAGS = {"b": "b", "strong": "b", "i": "i", "em": "i", "u": "u", "ins": "u", "s": "s", "strike": "s", "del": "s",
            "code": "c", "pre": "c", "tg-spoiler": "sp", "blockquote": "q", "a": "a"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.n, self.stack, self.ents = [], 0, [], []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "br":
            return self.handle_data("\n")
        t = self.TAGS.get(tag)
        if tag == "span" and "tg-spoiler" in (a.get("class") or ""):
            t = "sp"
        if t:
            self.stack.append((tag, t, self.n, a.get("href") or ""))

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag or (tag == "span" and self.stack[i][1] == "sp"):
                _, t, start, href = self.stack.pop(i)
                if self.n > start:
                    e = {"t": t, "o": start, "l": self.n - start}
                    if t == "a":
                        e["u"] = href
                    self.ents.append(e)
                return

    def handle_data(self, data):
        self.out.append(data)
        self.n += utf16len(data)


def bot_parse(text, mode, ents_param=None):
    """Текст бота + parse_mode/entities → (чистый текст, [наши entities])."""
    text = str(text or "")
    if isinstance(ents_param, str):
        try:
            ents_param = json.loads(ents_param)
        except Exception:
            ents_param = None
    if isinstance(ents_param, list):
        ents = []
        for e in ents_param[:200]:
            if not isinstance(e, dict):
                continue
            t = _T2O.get(e.get("type"))
            if t:
                ents.append({"t": t, "o": e.get("offset"), "l": e.get("length")})
            elif e.get("type") == "text_link" and e.get("url"):
                ents.append({"t": "a", "o": e.get("offset"), "l": e.get("length"), "u": str(e["url"])})
        return text, ents
    mode = str(mode or "").lower()
    if mode == "html":
        p = _FmtHTML()
        try:
            p.feed(text)
            p.close()
        except Exception:
            raise BotErr(400, "Bad Request: can't parse entities: invalid HTML")
        return "".join(p.out), sorted(p.ents, key=lambda e: e["o"])
    if mode in ("markdown", "markdownv2"):
        return _fmt_markdown(text, mode == "markdownv2")
    return text, []


def _fmt_markdown(text, v2):
    """Минимальный разбор Markdown/MarkdownV2: *жирный*, _курсив_, __подчёркнутый__, ~зачёркнутый~, ||скрытый||, `код`, [текст](url)."""
    out, n, ents, i = [], 0, [], 0
    open_ = {}
    marks = [("||", "sp"), ("__", "u"), ("*", "b"), ("_", "i"), ("~", "s")] if v2 else [("*", "b"), ("_", "i")]

    def put(s):
        nonlocal n
        out.append(s)
        n += utf16len(s)

    while i < len(text):
        c = text[i]
        if c == "\\" and i + 1 < len(text):
            put(text[i + 1]); i += 2; continue
        if c == "`":
            j = text.find("`", i + 1)
            if j > 0:
                s = text[i + 1:j]
                ents.append({"t": "c", "o": n, "l": utf16len(s)}); put(s); i = j + 1; continue
        if c == "[":
            m = re.match(r"\[([^\]]+)\]\(([^)\s]+)\)", text[i:])
            if m:
                ents.append({"t": "a", "o": n, "l": utf16len(m.group(1)), "u": m.group(2)}); put(m.group(1)); i += m.end(); continue
        hit_ = next((mk for mk in marks if text.startswith(mk[0], i)), None)
        if hit_:
            tok, t = hit_
            if tok in open_:
                st = open_.pop(tok)
                if n > st:
                    ents.append({"t": t, "o": st, "l": n - st})
            else:
                open_[tok] = n
            i += len(tok); continue
        put(c); i += 1
    return "".join(out), sorted(ents, key=lambda e: e["o"])


# ───────────── клавиатуры ─────────────
def bot_markup(rm):
    """reply_markup Telegram → (inline-кнопки, reply-клавиатура) в нашем виде. Ошибка — BotErr."""
    if rm in (None, "", {}):
        return None, None
    if isinstance(rm, str):
        try:
            rm = json.loads(rm)
        except Exception:
            raise BotErr(400, "Bad Request: can't parse reply keyboard markup JSON object")
    if not isinstance(rm, dict):
        raise BotErr(400, "Bad Request: reply markup must be an object")
    if isinstance(rm.get("inline_keyboard"), list):
        rows = []
        for row in rm["inline_keyboard"][:12]:
            if not isinstance(row, list):
                raise BotErr(400, "Bad Request: inline keyboard row must be an array")
            r = []
            for b in row[:8]:
                if not isinstance(b, dict) or not str(b.get("text") or "").strip():
                    raise BotErr(400, "Bad Request: text buttons are unallowed in the inline keyboard")
                x = {"t": str(b["text"])[:64]}
                if b.get("callback_data") is not None:
                    cd = str(b["callback_data"])
                    if not cd or len(cd.encode()) > 64:
                        raise BotErr(400, "Bad Request: BUTTON_DATA_INVALID")
                    x["d"] = cd
                elif b.get("url"):
                    if not URL_OK.match(str(b["url"])):
                        raise BotErr(400, "Bad Request: wrong HTTP URL specified")
                    x["u"] = str(b["url"])
                elif isinstance(b.get("web_app"), dict) and b["web_app"].get("url"):
                    if not re.match(r"^https://[^\s<>\"']{1,480}$", str(b["web_app"]["url"]), re.I):
                        raise BotErr(400, "Bad Request: web app url must use https")
                    x["w"] = str(b["web_app"]["url"])
                elif b.get("pay"):
                    x["p"] = 1
                else:
                    raise BotErr(400, "Bad Request: inline button must have callback_data, url, web_app or pay")
                r.append(x)
            if r:
                rows.append(r)
        return rows or None, None
    if isinstance(rm.get("keyboard"), list):
        rows = []
        for row in rm["keyboard"][:20]:
            if not isinstance(row, list):
                raise BotErr(400, "Bad Request: keyboard row must be an array")
            r = []
            for b in row[:8]:
                t = b.get("text") if isinstance(b, dict) else b
                t = str(t or "")[:64]
                if t:
                    r.append(t)
            if r:
                rows.append(r)
        rk = {"k": rows, "rs": bool(rm.get("resize_keyboard")), "ot": bool(rm.get("one_time_keyboard")),
              "ph": str(rm.get("input_field_placeholder") or "")[:64]}
        return None, (rk if rows else {"rm": 1})
    if rm.get("remove_keyboard"):
        return None, {"rm": 1}
    if rm.get("force_reply"):
        return None, {"fr": 1, "ph": str(rm.get("input_field_placeholder") or "")[:64]}
    return None, None


# ───────────── файлы ботов ─────────────
def bot_url_ok(url):
    """Адрес для webhook/скачивания: только http(s), и только на внешние адреса (нельзя ходить во внутреннюю сеть сервера)."""
    try:
        pu = urlparse(url)
        if pu.scheme not in ("http", "https") or not pu.hostname:
            return False
        if HOOK_ALLOW_PRIVATE:
            return True
        import socket as _s
        infos = _s.getaddrinfo(pu.hostname, pu.port or (443 if pu.scheme == "https" else 80), proto=_s.IPPROTO_TCP)
        return bool(infos) and all(_public_ip(i[4][0]) for i in infos)
    except Exception:
        return False


def bot_store_file(bid, raw, name, mime):
    if not raw:
        raise BotErr(400, "Bad Request: file must be non-empty")
    if len(raw) > BOT_FILE_MAX:
        raise BotErr(413, "Request Entity Too Large")
    name = re.sub(r"[\\/\x00-\x1f]", "_", str(name or "file")).strip()[:120] or "file"
    mime = str(mime or "").lower()[:100]
    if not MIME_RE.match(mime):
        mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
    fid = secrets.token_hex(16)
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    with open(file_path(fid), "wb") as fh:
        fh.write(raw)
    run("INSERT INTO files(fid,owner,name,size,mime,got,done,ts) VALUES(?,?,?,?,?,?,1,?)", (fid, bid, name, len(raw), mime, len(raw), int(time.time())))
    return fid, name, mime, len(raw)


def bot_can_file(bid, fid):
    """Бот может читать файл только из своих переписок (личка с ним или группы, где он состоит)."""
    if not FID_RE.match(fid or ""):
        return False
    f = q1("SELECT owner FROM files WHERE fid=?", (fid,))
    if not f:
        return False
    if f["owner"] == bid:
        return True
    return bool(q1("""SELECT 1 FROM messages WHERE (fid=? OR tfid=?) AND (receiver=? OR sender=?) LIMIT 1""", (fid, fid, bid, bid)) or
                q1("""SELECT 1 FROM messages m JOIN chat_members c ON c.chat_id=-m.receiver AND c.user_id=?
                      WHERE m.receiver<0 AND (m.fid=? OR m.tfid=?) LIMIT 1""", (bid, fid, fid)))


def bot_media(bid, p, field, kind):
    """Значение поля (file_id / файл в multipart / ссылка) → att для сообщения."""
    f = request.files.get(field) if request else None
    raw, name, mime = None, "", ""
    if f is not None:
        raw = f.read(BOT_FILE_MAX + 1)
        name, mime = f.filename or field, f.mimetype or ""
    else:
        v = str(p.get(field) or "").strip()
        if not v:
            raise BotErr(400, f"Bad Request: there is no {field} in the request")
        if FID_RE.match(v):
            if not bot_can_file(bid, v):
                raise BotErr(400, "Bad Request: wrong file identifier/HTTP URL specified")
            r = q1("SELECT * FROM files WHERE fid=? AND done=1", (v,))
            if not r:
                raise BotErr(400, "Bad Request: wrong file identifier/HTTP URL specified")
            return {"fid": v, "name": r["name"], "size": r["size"], "mime": r["mime"]}
        if re.match(r"^https?://", v, re.I):
            if not bot_url_ok(v):
                raise BotErr(400, "Bad Request: failed to get HTTP URL content")
            try:
                resp = http.get(v, timeout=15, stream=True, allow_redirects=False)
                if resp.status_code != 200:
                    raise BotErr(400, "Bad Request: wrong HTTP URL specified")
                raw = resp.raw.read(BOT_FILE_MAX + 1, decode_content=True)
                mime = (resp.headers.get("Content-Type") or "").split(";")[0]
                name = urlparse(v).path.rsplit("/", 1)[-1] or field
            except BotErr:
                raise
            except Exception:
                raise BotErr(400, "Bad Request: failed to get HTTP URL content")
        else:
            raise BotErr(400, "Bad Request: wrong file identifier/HTTP URL specified")
    if not raw:
        raise BotErr(400, "Bad Request: file must be non-empty")
    if len(raw) > BOT_FILE_MAX:
        raise BotErr(413, "Request Entity Too Large")
    guess = mimetypes.guess_type(name)[0] if name else None
    if kind in ("photo", "gif"):
        sig = (raw[:3] == b"\xff\xd8\xff" and "image/jpeg") or (raw[:8] == b"\x89PNG\r\n\x1a\n" and "image/png") or \
              (raw[:4] == b"RIFF" and raw[8:12] == b"WEBP" and "image/webp") or (raw[:4] == b"GIF8" and "image/gif")
        if not sig:
            raise BotErr(400, "Bad Request: PHOTO_INVALID_DIMENSIONS" if kind == "photo" else "Bad Request: wrong file type")
        mime = sig
    elif kind == "voice":
        mime = mime if mime.startswith("audio/") else (guess if guess and guess.startswith("audio/") else "audio/ogg")
    else:
        mime = mime if MIME_RE.match(mime or "") and mime != "application/octet-stream" else (guess or "application/octet-stream")
    if mime in ("text/html", "application/xhtml+xml", "image/svg+xml", "text/javascript", "application/javascript") and kind == "file":
        mime = "application/octet-stream"          # исполняемые в браузере типы отдаём как обычные данные
    fid, name, mime, size = bot_store_file(bid, raw, name or field, mime)
    return {"fid": fid, "name": name, "size": size, "mime": mime}




# ───────────── отправка сообщений ботом, обновления, webhook ─────────────
def bot_send_msg(b, chat_id, text="", ents=None, kind="text", att=None, reply_to=None, kb=None, rk=None, inv=None, topic=0):
    """Сообщение от имени бота. Возвращает строку messages. Ошибка — BotErr (как у Telegram)."""
    bid = b["id"]
    text = text or ""
    if kind == "text" and not text.strip():
        raise BotErr(400, "Bad Request: message text is empty")
    if len(text) > (4096 if kind == "text" else 1024):
        raise BotErr(400, "Bad Request: message is too long" if kind == "text" else "Bad Request: message caption is too long")
    ents = clean_ents(ents, utf16len(text), None) if text else []
    extra = {"bot": 1, "kb": kb, "rk": rk, "inv": inv}
    if chat_id > 0:
        t = fresh(chat_id)
        if not t or t.get("deleted") or t.get("banned") or t.get("bot") or t.get("is_system"):
            raise BotErr(400, "Bad Request: chat not found")
        bu = q1("SELECT * FROM bot_users WHERE bot_id=? AND uid=?", (bid, chat_id))
        if not bu:
            raise BotErr(403, "Forbidden: bot can't initiate conversation with a user")
        if bu["blocked"] or block_err(bid, chat_id):
            raise BotErr(403, "Forbidden: bot was blocked by the user")
        if not hit("bchat", f"{bid}:{chat_id}", 30, 10):
            raise BotErr(429, "Too Many Requests: retry after 5", {"retry_after": 5})
        rt = None
        if reply_to:
            rr = q1("SELECT id FROM messages WHERE id=? AND ((sender=? AND receiver=?) OR (sender=? AND receiver=?))", (reply_to, bid, chat_id, chat_id, bid))
            rt = rr["id"] if rr else None
        msg = add_message(bid, chat_id, text, None, kind, ents, att, rt, extra=extra)
    else:
        ch = chat_row(-chat_id)
        if not ch:
            raise BotErr(400, "Bad Request: chat not found")
        m = member_row(ch["id"], bid)
        if not m:
            raise BotErr(403, "Forbidden: bot is not a member of the group chat")
        try:
            check_post(ch, m, kind, text, att)
        except ValueError as e:
            raise BotErr(403, "Forbidden: " + str(e))
        if not hit("bchat", f"{bid}:{chat_id}", 60, 10):
            raise BotErr(429, "Too Many Requests: retry after 5", {"retry_after": 5})
        tid = 0
        if topic and ch["kind"] == "group" and ch["topics"] and q1("SELECT 1 FROM chat_topics WHERE id=? AND chat_id=?", (topic, ch["id"])):
            tid = topic
        rt = None
        if reply_to:
            rr = q1("SELECT id FROM messages WHERE id=? AND receiver=?", (reply_to, chat_id))
            rt = rr["id"] if rr else None
        msg = add_gmessage(ch, bid, text, None, kind, ents, att, rt, topic=tid, extra=extra)
    run("UPDATE bots SET msgs_out=msgs_out+1 WHERE id=?", (bid,))
    return q1("SELECT * FROM messages WHERE id=?", (msg["id"],))


def bot_row_for(b, chat_id, mid):
    """Сообщение бота (или входящее в его личке) по chat_id + message_id, иначе BotErr."""
    r = q1("SELECT * FROM messages WHERE id=?", (num(mid, 1, 2 ** 62) or 0,))
    ok = False
    if r:
        if chat_id < 0:
            ok = r["receiver"] == chat_id and bool(member_row(-chat_id, b["id"]))
        else:
            ok = (r["sender"] == b["id"] and r["receiver"] == chat_id) or (r["receiver"] == b["id"] and r["sender"] == chat_id)
    if not ok:
        raise BotErr(400, "Bad Request: message to edit not found")
    return r


def bot_edit_row(row, text=None, ents=None, kb=None, set_kb=False, mark=True):
    """Изменить сообщение бота (текст и/или кнопки) и разослать правку участникам."""
    meta = meta_load(row["meta"])
    ts = int(time.time())
    if set_kb:
        meta["kb"] = kb or None
    if text is not None:
        meta["e"] = ents or None
    if mark:
        meta["edit"] = ts
    run("UPDATE messages SET text=?, meta=?, edited=? WHERE id=?",
        (encrypt_text(text) if text is not None else row["text"], meta_dump(meta), ts if mark else row.get("edited") or 0, row["id"]))
    row = q1("SELECT * FROM messages WHERE id=?", (row["id"],))
    for v in audience(row):
        if clients.get(v):
            push(v, {"type": "edit", "message": ser_one(row, v)})
    return row


def bot_delete_row(row):
    run("DELETE FROM messages WHERE id=?", (row["id"],))
    run("DELETE FROM reacts WHERE msg_id=?", (row["id"],))
    gc_files([row.get("fid"), row.get("tfid")])
    for v in audience(row):
        if clients.get(v):
            push(v, {"type": "del", "ids": [row["id"]]})


def bot_push_update(bot_id, upd):
    """Положить обновление в очередь бота (его заберёт getUpdates или отправит webhook). Возвращает update_id."""
    b = bot_row(bot_id)
    if not b or not b["enabled"]:
        return 0
    now = int(time.time())
    with db_lock:
        uid_ = run("INSERT INTO bot_updates(bot_id,data,ts) VALUES(?,?,?)", (bot_id, json.dumps(upd, ensure_ascii=False, separators=(",", ":")), now)).lastrowid
        n = (q1("SELECT COUNT(*) n FROM bot_updates WHERE bot_id=?", (bot_id,)) or {}).get("n", 0)
        if n > BOT_UPD_MAX:
            run("DELETE FROM bot_updates WHERE bot_id=? AND id IN (SELECT id FROM bot_updates WHERE bot_id=? ORDER BY id LIMIT ?)",
                (bot_id, bot_id, n - BOT_UPD_MAX))
    if b["hook_url"]:
        hook_kick(bot_id)
    with bot_cond:
        bot_cond.notify_all()
    return uid_


def hook_kick(bot_id):
    _hook_q.put(bot_id)


def hook_post(b, upd):
    """Отправить обновление на webhook. → (успех, пояснение, ответ-метод|None)."""
    url = b["hook_url"]
    if not bot_url_ok(url):
        return False, "bad webhook url", None
    h = {"Content-Type": "application/json"}
    if b.get("hook_secret"):
        h["X-Telegram-Bot-Api-Secret-Token"] = b["hook_secret"]
        h["X-Dicegram-Bot-Api-Secret-Token"] = b["hook_secret"]
    try:
        r = http.post(url, data=json.dumps(upd, ensure_ascii=False).encode(), headers=h, timeout=10, allow_redirects=False)
    except Exception as e:
        return False, ("connection error: " + type(e).__name__)[:120], None
    if 200 <= r.status_code < 300:
        rep = None
        try:
            j = r.json()
            if isinstance(j, dict) and j.get("method"):
                rep = j
        except Exception:
            pass
        return True, "", rep
    return False, f"Wrong response from the webhook: {r.status_code}", None


def hook_drain(bid):
    for _ in range(300):
        b = bot_row(bid)
        if not b or not b["hook_url"] or not b["enabled"]:
            return
        if time.time() < _hook_retry.get(bid, 0):
            return
        row = q1("SELECT * FROM bot_updates WHERE bot_id=? ORDER BY id LIMIT 1", (bid,))
        if not row:
            return
        upd = dict(json.loads(row["data"]), update_id=row["id"])
        ok, info, rep = hook_post(b, upd)
        now = int(time.time())
        if ok:
            run("DELETE FROM bot_updates WHERE id=?", (row["id"],))
            if b["hook_err"]:
                run("UPDATE bots SET hook_err='' WHERE id=?", (bid,))
            if rep:
                try:
                    p = {k: v for k, v in rep.items() if k != "method"}
                    fn = BOT_METHODS.get(str(rep["method"]).lower())
                    if fn:
                        fn(b, fresh(bid), p)
                except Exception as e:
                    print("webhook reply:", repr(e))
        else:
            tries = row["tries"] + 1
            run("UPDATE bots SET hook_err=?, hook_err_ts=? WHERE id=?", (info[:200], now, bid))
            if tries >= 12:
                run("DELETE FROM bot_updates WHERE id=?", (row["id"],))      # не доставили 12 раз подряд — отбрасываем, чтобы не копить очередь
                continue
            run("UPDATE bot_updates SET tries=? WHERE id=?", (tries, row["id"]))
            delay = min(60, 2 ** tries)
            _hook_retry[bid] = time.time() + delay
            threading.Timer(delay + 0.1, hook_kick, (bid,)).start()
            return


def hook_worker():
    while True:
        bid = _hook_q.get()
        with _hook_lock:
            if bid in _hook_busy:
                continue
            _hook_busy.add(bid)
        try:
            hook_drain(bid)
        except Exception as e:
            print("hook_drain:", repr(e))
        finally:
            with _hook_lock:
                _hook_busy.discard(bid)


def bots_boot():
    """При старте: запустить обработчики webhook и дослать накопившееся."""
    for _ in range(4):
        threading.Thread(target=hook_worker, daemon=True, name="bot-hook").start()
    for r in qa("SELECT id FROM bots WHERE hook_url!='' AND enabled=1"):
        hook_kick(r["id"])


def bots_gc():
    now = int(time.time())
    run("DELETE FROM bot_updates WHERE ts<?", (now - BOT_UPD_TTL,))
    run("DELETE FROM bot_cbq WHERE ts<?", (now - 3600,))


# ───────────── входящие: человек → бот ─────────────
def bot_incoming(u, to_id, mid):
    """Человек написал боту в личку."""
    b = bot_row(to_id)
    if not b:
        return
    if to_id == dicebot_id():
        return dicebot_handle(u, mid)
    now = int(time.time())
    with db_lock:
        if q1("SELECT 1 FROM bot_users WHERE bot_id=? AND uid=?", (to_id, u["id"])):
            run("UPDATE bot_users SET last=?, msgs=msgs+1, blocked=0 WHERE bot_id=? AND uid=?", (now, to_id, u["id"]))
        else:
            run("INSERT INTO bot_users(bot_id,uid,first,last,msgs) VALUES(?,?,?,?,1)", (to_id, u["id"], now, now))
        run("UPDATE bots SET msgs_in=msgs_in+1 WHERE id=?", (to_id,))
    if not b["enabled"]:
        return                                   # отключённый бот просто молчит: человек видит /start без ответа и сам понимает, что бот не работает
    row = q1("SELECT * FROM messages WHERE id=?", (mid,))
    if row:
        bot_push_update(to_id, {"message": tg_message(row, to_id)})


def bot_group_hook(ch, row, sender_u):
    """Сообщение в группе → обновления для ботов группы (по режиму приватности: только команды, упоминания и ответы им)."""
    if sender_u.get("bot") or ch["kind"] not in ("group", "channel"):
        return
    bots = qa("""SELECT b.* FROM bots b JOIN chat_members m ON m.user_id=b.id AND m.chat_id=? WHERE b.enabled=1""", (ch["id"],))
    if not bots:
        return
    if ch["kind"] == "channel":                              # в канале бот видит все посты (channel_post), как в Telegram
        for b in bots:
            bot_push_update(b["id"], {"channel_post": tg_message(row, b["id"])})
        return
    text = decrypt_text(row["text"])
    rr = q1("SELECT sender FROM messages WHERE id=?", (row["reply_to"],)) if row.get("reply_to") else None
    for b in bots:
        un = (fresh(b["id"]) or {}).get("username") or ""
        ok = not b["privacy"]
        if not ok:
            if text.startswith("/"):
                m = re.match(r"^/\w+(?:@(\w+))?", text)
                tgt = m.group(1) if m else None
                ok = tgt is None or tgt.lower() == un.lower()
            if not ok and un and re.search(r"(?<!\w)@" + re.escape(un) + r"(?!\w)", text, re.I):
                ok = True
            if not ok and rr and rr["sender"] == b["id"]:
                ok = True
        if ok:
            bot_push_update(b["id"], {"message": tg_message(row, b["id"])})


# ───────────── кнопки под сообщением и звёзды ─────────────
@app.post("/api/bot/cb")
def bot_cb():
    """Нажатие inline-кнопки под сообщением бота."""
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    d = body()
    mid = num(d.get("id"), 1, 2 ** 62) or 0
    data = str(d.get("d") or "")[:64]
    row = q1("SELECT * FROM messages WHERE id=?", (mid,))
    if not row or not vis(row, u["id"]):
        return err("Сообщение не найдено", 404)
    if row["receiver"] < 0:
        if not member_row(-row["receiver"], u["id"]):
            return err("Нет доступа", 403)
    elif row["receiver"] != u["id"]:
        return err("Нет доступа", 403)
    meta = meta_load(row["meta"])
    if not any(x.get("d") == data for r in (meta.get("kb") or []) for x in r):
        return err("Кнопка устарела", 404)
    if not hit("botcb", u["id"], 30, 10):
        return err("Слишком часто", 429)
    sid = row["sender"]
    if sid == dicebot_id():
        try:
            res = dicebot_cb(u, row, data)
        except Exception as e:
            print("dicebot_cb:", repr(e))
            res = "Ошибка. Попробуйте ещё раз"
        return jsonify(ok=True, toast=res or "")
    b = bot_row(sid)
    if not b or not b["enabled"]:
        return jsonify(ok=True)                       # отключённый бот молчит, без сообщений об ошибке
    cbid = secrets.token_hex(8)
    run("INSERT INTO bot_cbq(id,bot_id,uid,mid,ts) VALUES(?,?,?,?,?)", (cbid, sid, u["id"], mid, int(time.time())))
    bot_push_update(sid, {"callback_query": {"id": cbid, "from": tg_user(u), "message": tg_message(row, sid),
                                              "chat_instance": str(u["id"]), "data": data}})
    return jsonify(ok=True, cb=cbid, alive=bot_alive(b))


def bot_pay_do(u, row):
    """Оплата счёта (sendInvoice) звёздами. → (текст ошибки | None, новый баланс)."""
    meta = meta_load(row["meta"])
    inv = meta.get("inv")
    b = bot_row(row["sender"])
    if not inv or not b or row["receiver"] != u["id"]:
        return "Счёт не найден", 0
    if inv.get("paid"):
        return "Этот счёт уже оплачен", 0
    amt = int(inv.get("a") or 0)
    if amt < 1:
        return "Неверная сумма", 0
    if not b["enabled"] or not bot_alive(b):
        return "Бот сейчас не на связи — оплата невозможна, попробуйте позже", 0
    if (u.get("stars") or 0) < amt:
        return f"Недостаточно звёзд: нужно {amt} ⭐", 0
    if not hit("botpay", u["id"], 10, 60):
        return "Слишком часто. Подождите минуту", 0
    # шаг 1: pre_checkout_query — бот должен ответить answerPreCheckoutQuery за 10 секунд (как в Telegram)
    qid = secrets.token_hex(8)
    ev = {"ev": threading.Event(), "ok": None, "err": ""}
    _pcq[qid] = ev
    bot_push_update(b["id"], {"pre_checkout_query": {"id": qid, "from": tg_user(u), "currency": "XTR", "total_amount": amt,
                                                      "invoice_payload": inv.get("p", "")}})
    ev["ev"].wait(10)
    _pcq.pop(qid, None)
    if ev["ok"] is False:
        return ev["err"] or "Бот отклонил оплату", 0
    if ev["ok"] is None:
        return "Бот не ответил вовремя — оплата отменена", 0
    # шаг 2: списание и зачисление владельцу бота (комиссии нет)
    charge = "dg_" + secrets.token_hex(10)
    with db_lock:
        cur = run("UPDATE users SET stars=stars-? WHERE id=? AND stars>=?", (amt, u["id"], amt))
        if not cur.rowcount:
            return f"Недостаточно звёзд: нужно {amt} ⭐", 0
        run("UPDATE users SET stars=stars+? WHERE id=?", (amt, b["owner"]))
        run("UPDATE bots SET stars_in=stars_in+? WHERE id=?", (amt, b["id"]))
        run("INSERT INTO bot_pay(bot_id,uid,mid,amount,title,payload,charge,ts) VALUES(?,?,?,?,?,?,?,?)",
            (b["id"], u["id"], row["id"], amt, inv.get("t", ""), inv.get("p", ""), charge, int(time.time())))
    bu = fresh(b["id"]) or {}
    star_tx(u["id"], -amt, f"Оплата: {inv.get('t', 'счёт')} (@{bu.get('username', '')})", "bot_pay")
    star_tx(b["owner"], amt, f"Оплата в @{bu.get('username', '')}: {inv.get('t', 'счёт')}", "bot_income")
    inv["paid"] = 1
    meta["inv"], meta["kb"] = inv, None
    run("UPDATE messages SET meta=? WHERE id=?", (meta_dump(meta), row["id"]))
    row = q1("SELECT * FROM messages WHERE id=?", (row["id"],))
    for v in audience(row):
        if clients.get(v):
            push(v, {"type": "edit", "message": ser_one(row, v)})
    msg = tg_message(row, b["id"])
    msg["from"], msg["chat"] = tg_user(u), tg_chat_user(u)
    msg.pop("invoice", None)
    msg["successful_payment"] = {"currency": "XTR", "total_amount": amt, "invoice_payload": inv.get("p", ""),
                                 "telegram_payment_charge_id": charge, "provider_payment_charge_id": charge}
    bot_push_update(b["id"], {"message": msg})
    notify_profile(u["id"])
    notify_profile(b["owner"])
    return None, (fresh(u["id"]) or {}).get("stars") or 0


@app.post("/api/bot/pay")
def bot_pay_route():
    u = auth_user()
    if not u:
        return err("Требуется вход", 401)
    d = body()
    row = q1("SELECT * FROM messages WHERE id=?", (num(d.get("id"), 1, 2 ** 62) or 0,))
    if not row or not vis(row, u["id"]):
        return err("Счёт не найден", 404)
    e, bal = bot_pay_do(u, row)
    if e:
        return jsonify(ok=False, error=e, short=(e.startswith("Недостаточно"))), 402 if e.startswith("Недостаточно") else 400
    return jsonify(ok=True, stars=bal)




# ───────────── Bot API: методы (названия и поля — как у Telegram) ─────────────
def _i(v, default=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _truthy(v):
    return v is True or str(v).lower() in ("1", "true", "yes")


def bot_chat_id(p, key="chat_id"):
    v = p.get(key)
    if isinstance(v, str) and v.startswith("@"):
        ch = q1("SELECT id FROM chats WHERE slug=? COLLATE NOCASE", (v[1:],))
        if ch:
            return -ch["id"]
        raise BotErr(400, "Bad Request: chat not found")
    cid = _i(v, 0)
    if not cid:
        raise BotErr(400, "Bad Request: chat_id is empty")
    return cid


def _reply_id(p):
    rid = _i(p.get("reply_to_message_id"), 0)
    rp = p.get("reply_parameters")
    if isinstance(rp, str):
        try:
            rp = json.loads(rp)
        except Exception:
            rp = None
    if isinstance(rp, dict):
        rid = _i(rp.get("message_id"), rid)
    return rid or None


def m_getMe(b, u, p):
    return {"id": u["id"], "is_bot": True, "first_name": u["name"], "username": u["username"], "can_join_groups": bool(b["groups_ok"]),
            "can_read_all_group_messages": not b["privacy"], "supports_inline_queries": False}


def m_getUpdates(b, u, p):
    if b["hook_url"]:
        raise BotErr(409, "Conflict: can't use getUpdates method while webhook is active; use deleteWebhook to delete the webhook first")
    bid = b["id"]
    off = _i(p.get("offset"), 0)
    limit = max(1, min(100, _i(p.get("limit"), 100)))
    timeout = max(0, min(50, _i(p.get("timeout"), 0)))
    with _gu_lock:
        if _gu_active.get(bid):
            raise BotErr(409, "Conflict: terminated by other getUpdates request; make sure that only one bot instance is running")
        _gu_active[bid] = time.time()
    try:
        if off < 0:                                           # offset=-1 — «только самое последнее»
            last = q1("SELECT MAX(id) m FROM bot_updates WHERE bot_id=?", (bid,))
            off = max(0, (last["m"] or 0) + off + 1) if last and last["m"] else 0
        elif off:
            run("DELETE FROM bot_updates WHERE bot_id=? AND id<?", (bid, off))      # offset подтверждает всё, что раньше
        deadline = time.time() + timeout
        while True:
            _bot_seen[bid] = time.time()
            rows = qa("SELECT id, data FROM bot_updates WHERE bot_id=? AND id>=? ORDER BY id LIMIT ?", (bid, off, limit))
            left = deadline - time.time()
            if rows or left <= 0:
                break
            with bot_cond:
                bot_cond.wait(timeout=min(4.0, max(0.05, left)))
        return [dict(json.loads(r["data"]), update_id=r["id"]) for r in rows]
    finally:
        with _gu_lock:
            _gu_active.pop(bid, None)


def m_setWebhook(b, u, p):
    url = str(p.get("url") or "").strip()
    if not url:
        return m_deleteWebhook(b, u, p)
    if len(url) > 500 or not (url.lower().startswith("https://") or HOOK_ALLOW_PRIVATE):
        raise BotErr(400, "Bad Request: bad webhook: HTTPS url must be provided for webhook")
    if not bot_url_ok(url):
        raise BotErr(400, "Bad Request: bad webhook: failed to resolve host or the address is not public")
    secret = str(p.get("secret_token") or "")[:256]
    if secret and not re.fullmatch(r"[A-Za-z0-9_-]{1,256}", secret):
        raise BotErr(400, "Bad Request: secret token contains unallowed characters")
    if _truthy(p.get("drop_pending_updates")):
        run("DELETE FROM bot_updates WHERE bot_id=?", (b["id"],))
    run("UPDATE bots SET hook_url=?, hook_secret=?, hook_ts=?, hook_err='', hook_err_ts=0 WHERE id=?", (url, secret, int(time.time()), b["id"]))
    _hook_retry.pop(b["id"], None)
    hook_kick(b["id"])
    return True


def m_deleteWebhook(b, u, p):
    if _truthy(p.get("drop_pending_updates")):
        run("DELETE FROM bot_updates WHERE bot_id=?", (b["id"],))
    run("UPDATE bots SET hook_url='', hook_secret='', hook_err='', hook_err_ts=0 WHERE id=?", (b["id"],))
    return True


def m_getWebhookInfo(b, u, p):
    b = bot_row(b["id"])
    n = (q1("SELECT COUNT(*) n FROM bot_updates WHERE bot_id=?", (b["id"],)) or {}).get("n", 0)
    d = {"url": b["hook_url"] or "", "has_custom_certificate": False, "pending_update_count": n, "max_connections": 1}
    if b["hook_err"]:
        d["last_error_date"], d["last_error_message"] = b["hook_err_ts"], b["hook_err"]
    return d


def _markup_of(p):
    return bot_markup(p.get("reply_markup"))


def m_sendMessage(b, u, p):
    cid = bot_chat_id(p)
    text, ents = bot_parse(p.get("text"), p.get("parse_mode"), p.get("entities"))
    kb, rk = _markup_of(p)
    row = bot_send_msg(b, cid, text, ents, "text", None, _reply_id(p), kb, rk, topic=_i(p.get("message_thread_id"), 0))
    return tg_message(row, b["id"])


def _send_media(field, kind):
    def fn(b, u, p):
        cid = bot_chat_id(p)
        att = bot_media(b["id"], p, field, kind)
        text, ents = bot_parse(p.get("caption"), p.get("parse_mode"), p.get("caption_entities"))
        if kind == "voice":
            dur = _i(p.get("duration"), 0)
            if dur:
                att["dur"] = dur * 1000
            text, ents = "", []
        if kind == "photo":
            w, h = _i(p.get("width"), 0), _i(p.get("height"), 0)
            if w and h:
                att["w"], att["h"] = min(w, 20000), min(h, 20000)
        kb, rk = _markup_of(p)
        row = bot_send_msg(b, cid, text, ents, kind, att, _reply_id(p), kb, rk, topic=_i(p.get("message_thread_id"), 0))
        return tg_message(row, b["id"])
    return fn


def m_sendChatAction(b, u, p):
    cid = bot_chat_id(p)
    if cid > 0 and q1("SELECT 1 FROM bot_users WHERE bot_id=? AND uid=? AND blocked=0", (b["id"], cid)) and hit("bact", f"{b['id']}:{cid}", 12, 10):
        push(cid, {"type": "typing", "from": b["id"], "chat": b["id"], "act": str(p.get("action") or "typing")[:20]})
    return True


def m_editMessageText(b, u, p):
    cid = bot_chat_id(p)
    row = bot_row_for(b, cid, p.get("message_id"))
    if row["sender"] != b["id"] or (row.get("kind") or "text") != "text" or meta_load(row["meta"]).get("inv"):
        raise BotErr(400, "Bad Request: message can't be edited")
    text, ents = bot_parse(p.get("text"), p.get("parse_mode"), p.get("entities"))
    if not text.strip() or len(text) > 4096:
        raise BotErr(400, "Bad Request: message text is empty or too long")
    kb, rk = _markup_of(p)
    ents = clean_ents(ents, utf16len(text), None)
    if text == decrypt_text(row["text"]) and kb == (meta_load(row["meta"]).get("kb") or None):
        raise BotErr(400, "Bad Request: message is not modified: specified new message content and reply markup are exactly the same")
    return tg_message(bot_edit_row(row, text, ents, kb, True), b["id"])


def m_editMessageCaption(b, u, p):
    cid = bot_chat_id(p)
    row = bot_row_for(b, cid, p.get("message_id"))
    if row["sender"] != b["id"] or (row.get("kind") or "text") in ("text", "voice", "sticker"):
        raise BotErr(400, "Bad Request: there is no caption in the message to edit")
    text, ents = bot_parse(p.get("caption"), p.get("parse_mode"), p.get("caption_entities"))
    if len(text) > 1024:
        raise BotErr(400, "Bad Request: message caption is too long")
    kb, rk = _markup_of(p)
    return tg_message(bot_edit_row(row, text, clean_ents(ents, utf16len(text), None), kb, True), b["id"])


def m_editMessageReplyMarkup(b, u, p):
    cid = bot_chat_id(p)
    row = bot_row_for(b, cid, p.get("message_id"))
    if row["sender"] != b["id"]:
        raise BotErr(400, "Bad Request: message can't be edited")
    kb, rk = _markup_of(p)
    return tg_message(bot_edit_row(row, None, None, kb, True), b["id"])


def m_deleteMessage(b, u, p):
    cid = bot_chat_id(p)
    row = bot_row_for(b, cid, p.get("message_id"))
    if row["sender"] != b["id"] and not (cid > 0 and row["receiver"] == b["id"]):
        raise BotErr(400, "Bad Request: message can't be deleted")
    bot_delete_row(row)
    return True


def m_answerCallbackQuery(b, u, p):
    qid = str(p.get("callback_query_id") or "")
    r = q1("SELECT * FROM bot_cbq WHERE id=? AND bot_id=?", (qid, b["id"]))
    if not r:
        raise BotErr(400, "Bad Request: query is too old and response timeout expired or query ID is invalid")
    run("DELETE FROM bot_cbq WHERE id=?", (qid,))
    url = str(p.get("url") or "")
    push(r["uid"], {"type": "cbans", "id": qid, "mid": r["mid"], "text": str(p.get("text") or "")[:200],
                    "alert": _truthy(p.get("show_alert")), "url": url if URL_OK.match(url) else ""})
    return True


def m_setMyCommands(b, u, p):
    cmds = p.get("commands")
    if isinstance(cmds, str):
        try:
            cmds = json.loads(cmds)
        except Exception:
            cmds = None
    if not isinstance(cmds, list) or len(cmds) > 100:
        raise BotErr(400, "Bad Request: commands must be an array of up to 100 items")
    out = []
    for c in cmds:
        if not isinstance(c, dict):
            raise BotErr(400, "Bad Request: can't parse commands")
        cm, ds = str(c.get("command") or "").lstrip("/").lower(), str(c.get("description") or "").strip()
        if not BOT_CMD_RE.match(cm):
            raise BotErr(400, "Bad Request: BOT_COMMAND_INVALID")
        if not (3 <= len(ds) <= 256):
            raise BotErr(400, "Bad Request: BOT_COMMAND_DESCRIPTION_INVALID")
        out.append({"command": cm, "description": ds})
    run("UPDATE bots SET cmds=? WHERE id=?", (json.dumps(out, ensure_ascii=False), b["id"]))
    notify_profile(b["id"])
    return True


def m_getMyCommands(b, u, p):
    return bot_cmds(bot_row(b["id"]))


def m_deleteMyCommands(b, u, p):
    run("UPDATE bots SET cmds='[]' WHERE id=?", (b["id"],))
    notify_profile(b["id"])
    return True


def m_setMyName(b, u, p):
    name = " ".join(str(p.get("name") or "").split())[:64]
    if name:
        if name.lower() in BOT_BAD_NAMES and not is_admin(fresh(b["owner"]) or {}):
            raise BotErr(400, "Bad Request: this name can't be used")
        run("UPDATE users SET name=? WHERE id=?", (name, b["id"]))
        notify_profile(b["id"])
    return True


def m_getMyName(b, u, p):
    return {"name": (fresh(b["id"]) or {}).get("name") or ""}


def m_setMyDescription(b, u, p):
    """Отдельного «описания» у ботов Dicegram нет — есть только «О боте»; метод оставлен для совместимости с Telegram-библиотеками."""
    run("UPDATE bots SET about=? WHERE id=?", (str(p.get("description") or "").strip()[:BOT_ABOUT_MAX], b["id"]))
    notify_profile(b["id"])
    return True


def m_getMyDescription(b, u, p):
    return {"description": bot_row(b["id"])["about"]}


def m_setMyShortDescription(b, u, p):
    run("UPDATE bots SET about=? WHERE id=?", (str(p.get("short_description") or "").strip()[:BOT_ABOUT_MAX], b["id"]))
    notify_profile(b["id"])
    return True


def m_getMyShortDescription(b, u, p):
    return {"short_description": bot_row(b["id"])["about"]}


def m_getChat(b, u, p):
    cid = bot_chat_id(p)
    if cid > 0:
        if not q1("SELECT 1 FROM bot_users WHERE bot_id=? AND uid=?", (b["id"], cid)):
            raise BotErr(400, "Bad Request: chat not found")
        t = fresh(cid)
        d = tg_chat_user(t)
        if t.get("bio"):
            d["bio"] = t["bio"]
        return d
    ch = chat_row(-cid)
    if not ch or not member_row(ch["id"], b["id"]):
        raise BotErr(400, "Bad Request: chat not found")
    d = tg_chat_group(ch)
    if ch.get("about"):
        d["description"] = ch["about"]
    return d


def m_getChatMember(b, u, p):
    cid = bot_chat_id(p)
    uid = _i(p.get("user_id"), 0)
    t = fresh(uid)
    if not t:
        raise BotErr(400, "Bad Request: user not found")
    if cid > 0:
        if cid != uid or not q1("SELECT 1 FROM bot_users WHERE bot_id=? AND uid=?", (b["id"], uid)):
            raise BotErr(400, "Bad Request: chat not found")
        return {"status": "member", "user": tg_user(t)}
    ch = chat_row(-cid)
    if not ch or not member_row(ch["id"], b["id"]):
        raise BotErr(400, "Bad Request: chat not found")
    m = member_row(ch["id"], uid)
    st = "left" if not m else {"owner": "creator", "admin": "administrator"}.get(m["role"], "member")
    return {"status": st, "user": tg_user(t)}


def m_getFile(b, u, p):
    fid = str(p.get("file_id") or "")
    if not bot_can_file(b["id"], fid):
        raise BotErr(400, "Bad Request: wrong file_id or the file is temporarily unavailable")
    f = q1("SELECT * FROM files WHERE fid=? AND done=1", (fid,))
    if not f:
        raise BotErr(400, "Bad Request: wrong file_id or the file is temporarily unavailable")
    from urllib.parse import quote
    return {"file_id": fid, "file_unique_id": fid[:16], "file_size": f["size"], "file_path": f"{fid}/{quote(f['name'] or 'file')}"}


def m_sendInvoice(b, u, p):
    cid = bot_chat_id(p)
    if cid < 0:
        raise BotErr(400, "Bad Request: invoices can be sent only to private chats")
    if str(p.get("currency") or "").upper() != "XTR":
        raise BotErr(400, "Bad Request: currency must be XTR (Telegram Stars)")
    prices = p.get("prices")
    if isinstance(prices, str):
        try:
            prices = json.loads(prices)
        except Exception:
            prices = None
    if not isinstance(prices, list) or len(prices) != 1 or not isinstance(prices[0], dict):
        raise BotErr(400, "Bad Request: prices must contain exactly one item for XTR")
    amt = _i(prices[0].get("amount"), 0)
    if not (1 <= amt <= 100000):
        raise BotErr(400, "Bad Request: TOTAL_AMOUNT_INVALID (1…100000)")
    title = str(p.get("title") or "").strip()[:32]
    descr = str(p.get("description") or "").strip()[:255]
    payload = str(p.get("payload") or "")[:128]
    if not title or not descr or not payload:
        raise BotErr(400, "Bad Request: title, description and payload are required")
    kb, rk = _markup_of(p)
    pay_btn = {"t": f"Оплатить ⭐{amt}", "p": 1}
    if kb and kb[0] and kb[0][0].get("p"):
        kb[0][0]["t"] = kb[0][0]["t"] or pay_btn["t"]
    else:
        kb = [[pay_btn]] + (kb or [])
    row = bot_send_msg(b, cid, f"🧾 {title}\n{descr}", None, "text", None, _reply_id(p), kb, None,
                       inv={"t": title, "d": descr, "a": amt, "p": payload})
    return tg_message(row, b["id"])


def m_answerPreCheckoutQuery(b, u, p):
    q = _pcq.get(str(p.get("pre_checkout_query_id") or ""))
    if not q:
        raise BotErr(400, "Bad Request: query is too old and response timeout expired or query ID is invalid")
    ok = _truthy(p.get("ok"))
    if not ok and not str(p.get("error_message") or "").strip():
        raise BotErr(400, "Bad Request: error_message is required when ok is False")
    q["ok"], q["err"] = ok, str(p.get("error_message") or "")[:200]
    q["ev"].set()
    return True


def m_refundStarPayment(b, u, p):
    charge = str(p.get("telegram_payment_charge_id") or "")
    uid = _i(p.get("user_id"), 0)
    with db_lock:
        r = q1("SELECT * FROM bot_pay WHERE bot_id=? AND charge=? AND uid=?", (b["id"], charge, uid))
        if not r or r["status"] != "paid":
            raise BotErr(400, "Bad Request: CHARGE_NOT_FOUND" if not r else "Bad Request: CHARGE_ALREADY_REFUNDED")
        cur = run("UPDATE users SET stars=stars-? WHERE id=? AND stars>=?", (r["amount"], b["owner"], r["amount"]))
        if not cur.rowcount:
            raise BotErr(400, "Bad Request: not enough stars on the bot owner's balance")
        run("UPDATE users SET stars=stars+? WHERE id=?", (r["amount"], uid))
        run("UPDATE bot_pay SET status='refunded' WHERE id=?", (r["id"],))
        run("UPDATE bots SET stars_in=stars_in-? WHERE id=?", (r["amount"], b["id"]))
    bu = fresh(b["id"]) or {}
    star_tx(uid, r["amount"], f"Возврат: {r['title']} (@{bu.get('username', '')})", "bot_refund")
    star_tx(b["owner"], -r["amount"], f"Возврат покупателю: {r['title']}", "bot_refund")
    notify_profile(uid)
    notify_profile(b["owner"])
    return True


BOT_PAYOUT_DAILY = env_int("BOT_PAYOUT_DAILY", 100000)      # сколько звёзд бот может выплатить людям за 24 часа (защита, если токен утечёт)


def m_transferStars(b, u, p):
    """Расширение Dicegram: выплата звёзд человеку с баланса владельца бота (вывод выигрыша, награды, кэшбэк).
    Идемпотентно: повтор с тем же idempotency_key ничего не делает и возвращает прежний результат."""
    uid, amt = _i(p.get("user_id"), 0), _i(p.get("amount"), 0)
    key = str(p.get("idempotency_key") or "").strip()[:64]
    if not (1 <= amt <= 100000):
        raise BotErr(400, "Bad Request: amount must be from 1 to 100000")
    if not key:
        raise BotErr(400, "Bad Request: idempotency_key is required")
    t = fresh(uid)
    if not t or t.get("deleted") or t.get("banned") or t.get("bot") or t.get("is_system"):
        raise BotErr(400, "Bad Request: user not found")
    bu = q1("SELECT * FROM bot_users WHERE bot_id=? AND uid=?", (b["id"], uid))
    if not bu or bu["blocked"]:
        raise BotErr(403, "Forbidden: user has not started the bot or has blocked it")
    ref = "dgo_" + secrets.token_hex(8)
    now = int(time.time())
    with db_lock:
        old = q1("SELECT * FROM bot_out WHERE bot_id=? AND key=?", (b["id"], key))
        if old:
            if old["uid"] != uid or old["amount"] != amt:
                raise BotErr(400, "Bad Request: idempotency_key was already used with other parameters")
            return {"id": old["ref"], "user_id": uid, "amount": amt, "repeated": True}
        spent = (q1("SELECT COALESCE(SUM(amount),0) s FROM bot_out WHERE bot_id=? AND ts>?", (b["id"], now - 86400)) or {}).get("s", 0)
        if spent + amt > BOT_PAYOUT_DAILY:
            raise BotErr(400, "Bad Request: daily payout limit of the bot is reached")
        cur = run("UPDATE users SET stars=stars-? WHERE id=? AND stars>=?", (amt, b["owner"], amt))
        if not cur.rowcount:
            raise BotErr(400, "Bad Request: not enough stars on the bot owner's balance")
        run("UPDATE users SET stars=stars+? WHERE id=?", (amt, uid))
        run("INSERT INTO bot_out(bot_id,uid,amount,key,ref,ts) VALUES(?,?,?,?,?,?)", (b["id"], uid, amt, key, ref, now))
    bu2 = fresh(b["id"]) or {}
    star_tx(uid, amt, f"Выплата от @{bu2.get('username', '')}", "bot_payout")
    star_tx(b["owner"], -amt, f"Выплата людям от @{bu2.get('username', '')}", "bot_payout")
    notify_profile(uid)
    notify_profile(b["owner"])
    return {"id": ref, "user_id": uid, "amount": amt}


def m_getStarTransactions(b, u, p):
    off, lim = max(0, _i(p.get("offset"), 0)), max(1, min(100, _i(p.get("limit"), 100)))
    rows = qa("SELECT * FROM bot_pay WHERE bot_id=? ORDER BY id DESC LIMIT ? OFFSET ?", (b["id"], lim, off))
    out = []
    for r in rows:
        t = fresh(r["uid"]) or {"id": r["uid"], "name": "?"}
        out.append({"id": r["charge"], "amount": r["amount"], "date": r["ts"], "source": {"type": "user", "user": tg_user(t)},
                    **({"refunded": True} if r["status"] == "refunded" else {})})
    return {"transactions": out}


def m_getMyStarBalance(b, u, p):
    return {"amount": bot_row(b["id"])["stars_in"], "nanostar_amount": 0}


def m_true(b, u, p):
    return True


def m_getChatMenuButton(b, u, p):
    return {"type": "default"}


BOT_METHODS = {k.lower(): v for k, v in {
    "getMe": m_getMe, "getUpdates": m_getUpdates, "setWebhook": m_setWebhook, "deleteWebhook": m_deleteWebhook,
    "getWebhookInfo": m_getWebhookInfo, "sendMessage": m_sendMessage,
    "sendPhoto": _send_media("photo", "photo"), "sendDocument": _send_media("document", "file"),
    "sendVideo": _send_media("video", "file"), "sendAudio": _send_media("audio", "file"),
    "sendVoice": _send_media("voice", "voice"), "sendAnimation": _send_media("animation", "gif"),
    "sendChatAction": m_sendChatAction, "editMessageText": m_editMessageText, "editMessageCaption": m_editMessageCaption,
    "editMessageReplyMarkup": m_editMessageReplyMarkup, "deleteMessage": m_deleteMessage,
    "answerCallbackQuery": m_answerCallbackQuery, "setMyCommands": m_setMyCommands, "getMyCommands": m_getMyCommands,
    "deleteMyCommands": m_deleteMyCommands, "setMyName": m_setMyName, "getMyName": m_getMyName,
    "setMyDescription": m_setMyDescription, "getMyDescription": m_getMyDescription,
    "setMyShortDescription": m_setMyShortDescription, "getMyShortDescription": m_getMyShortDescription,
    "getChat": m_getChat, "getChatMember": m_getChatMember, "getFile": m_getFile, "sendInvoice": m_sendInvoice,
    "answerPreCheckoutQuery": m_answerPreCheckoutQuery, "refundStarPayment": m_refundStarPayment, "transferStars": m_transferStars,
    "getStarTransactions": m_getStarTransactions, "getMyStarBalance": m_getMyStarBalance,
    "close": m_true, "logOut": m_true, "setChatMenuButton": m_true, "getChatMenuButton": m_getChatMenuButton,
    "setMyDefaultAdministratorRights": m_true,
}.items()}


def bot_fail(code, desc, params=None):
    d = {"ok": False, "error_code": code, "description": desc, "error": desc}
    if params:
        d["parameters"] = params
    r = jsonify(d)
    r.status_code = code
    return r


def bot_params():
    p = {}
    p.update(request.args.to_dict())
    if (request.mimetype or "") == "application/json":
        d = request.get_json(silent=True)
        if isinstance(d, dict):
            p.update(d)
    elif request.form:
        p.update(request.form.to_dict())
    return p


@app.route("/bot<token>/<method>", methods=["GET", "POST"])
def bot_api(token, method):
    a = bot_auth(token)
    if not a:
        return bot_fail(401, "Unauthorized")
    b, u = a
    if not b["enabled"]:
        return bot_fail(403, "Forbidden: the bot is disabled by its owner")
    now = time.time()
    if now - _bot_seen.get(b["id"], 0) > 30:
        run("UPDATE bots SET last_api=? WHERE id=?", (int(now), b["id"]))
    _bot_seen[b["id"]] = now
    fn = BOT_METHODS.get(method.lower())
    if not fn:
        return bot_fail(404, "Not Found")
    if method.lower() != "getupdates" and not hit("bapi", b["id"], 40, 1):
        return bot_fail(429, "Too Many Requests: retry after 1", {"retry_after": 1})
    if request.content_length and request.content_length > BODY_MAX and not (request.mimetype or "").startswith("multipart/"):
        return bot_fail(413, "Request Entity Too Large")
    try:
        res = fn(b, u, bot_params())
    except BotErr as e:
        return bot_fail(e.code, e.desc, e.params)
    except Exception as e:
        print("bot api", method, repr(e))
        return bot_fail(500, "Internal Server Error")
    return jsonify(ok=True, result=res)


def _bot_file_send(token, fid):
    a = bot_auth(token)
    if not a:
        return bot_fail(401, "Unauthorized")
    b, _u = a
    f = q1("SELECT * FROM files WHERE fid=? AND done=1", (fid,)) if FID_RE.match(fid or "") else None
    if not f or not bot_can_file(b["id"], fid) or not os.path.exists(file_path(fid)):
        return bot_fail(404, "Not Found")
    mime = f["mime"] if f["mime"] and not f["mime"].startswith(("text/html", "image/svg", "application/xhtml")) else "application/octet-stream"
    return send_file(file_path(fid), mimetype=mime, as_attachment=True, download_name=f["name"] or "file")


@app.get("/file/bot<token>/<fid>/<path:name>")
def bot_file_dl(token, fid, name):
    return _bot_file_send(token, fid)


@app.get("/file/bot<token>/<fid>")
def bot_file_dl2(token, fid):
    return _bot_file_send(token, fid)




# ───────────── создание и управление ботами ─────────────
def bot_username_err(un, owner_u):
    if not (5 <= len(un) <= 32) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", un):
        return "Username: от 5 до 32 символов — латиница, цифры и _, начинается с буквы."
    if not un.lower().endswith("bot"):
        return "Username бота должен заканчиваться на «bot», например my_helper_bot."
    if "__" in un:
        return "Нельзя использовать подряд два символа _"
    if (un.lower().startswith(BOT_BAD_PREFIX) or name_reserved(un, owner_u)) and not is_admin(owner_u):
        return "Это имя зарезервировано."
    if name_taken(un):
        return "Этот username уже занят."
    return None


def bot_create(owner_u, name, username):
    """→ (bots-строка, токен, None) или (None, None, текст ошибки)."""
    name = " ".join(str(name or "").split())
    username = str(username or "").strip().lstrip("@")
    if not (1 <= len(name) <= 64):
        return None, None, "Название: от 1 до 64 символов."
    if owner_u.get("bot") or owner_u.get("is_system"):
        return None, None, "Боты не могут создавать ботов."
    if name.lower() in BOT_BAD_NAMES and not is_admin(owner_u):
        return None, None, "Это название нельзя использовать."
    e = bot_username_err(username, owner_u)
    if e:
        return None, None, e
    cnt = (q1("SELECT COUNT(*) n FROM bots WHERE owner=?", (owner_u["id"],)) or {}).get("n", 0)
    lim = BOT_LIMIT
    if cnt >= lim:
        return None, None, f"Достигнут лимит: не больше {lim} ботов на один аккаунт."
    if not hit("botnew", owner_u["id"], 5, 3600):
        return None, None, "Слишком часто. Подождите немного и попробуйте снова."
    now = int(time.time())
    try:
        with db_lock:
            if name_taken(username):
                return None, None, "Этот username уже занят."
            uid = run("INSERT INTO users(number,name,username,created,bot,last_seen) VALUES(?,?,?,?,1,?)",
                      ("bot:t" + secrets.token_hex(5), name, username, now, now)).lastrowid
            run("UPDATE users SET number=? WHERE id=?", (f"bot:{uid}", uid))
            token, th = bot_make_token(uid)
            run("INSERT INTO bots(id,owner,tok_hash,tok_enc,tok_ts,created) VALUES(?,?,?,?,?,?)", (uid, owner_u["id"], th, encrypt_text(token), now, now))
    except sqlite3.IntegrityError:
        return None, None, "Этот username уже занят."
    hc_log(f"🤖 {who_label(owner_u)} создал(а) бота @{username}")
    return bot_row(uid), token, None


def bot_new_token(b):
    token, th = bot_make_token(b["id"])
    run("UPDATE bots SET tok_hash=?, tok_enc=?, tok_ts=? WHERE id=?", (th, encrypt_text(token), int(time.time()), b["id"]))
    return token


def bot_delete(b):
    bid = b["id"]
    u = fresh(bid) or {}
    drop_photo(u.get("avatar"))
    with db_lock:
        run("DELETE FROM chat_members WHERE user_id=?", (bid,))
        for t in ("bot_updates", "bot_users", "bot_admins", "bot_cbq"):
            run(f"DELETE FROM {t} WHERE bot_id=?", (bid,))
        run("DELETE FROM bots WHERE id=?", (bid,))
        run("UPDATE users SET deleted=1, username='', name='', surname='', bio='', avatar='', vtier='', number=? WHERE id=?", (f"deleted:{bid}", bid))
    with bot_cond:
        bot_cond.notify_all()
    notify_profile(bid)
    hc_log(f"🗑 Удалён бот @{u.get('username', '')} (#{bid})")


def bot_managed(uid, bid, owner_only=False):
    b = bot_row(bid)
    if not b or not bid:
        return None
    if b["owner"] == uid:
        return b, "owner"
    if not owner_only and q1("SELECT 1 FROM bot_admins WHERE bot_id=? AND uid=?", (bid, uid)):
        return b, "admin"
    return None


def bots_of(uid):
    rows = qa("""SELECT b.*, 'owner' role FROM bots b WHERE b.owner=? AND b.id!=?
                 UNION ALL SELECT b.*, 'admin' role FROM bots b JOIN bot_admins a ON a.bot_id=b.id WHERE a.uid=? ORDER BY created DESC""",
              (uid, dicebot_id(), uid))
    return rows


def bot_stats(b):
    now = int(time.time())
    r = q1("""SELECT COUNT(*) total, COALESCE(SUM(last>?),0) d1, COALESCE(SUM(last>?),0) d7, COALESCE(SUM(last>?),0) d30,
                     COALESCE(SUM(first>?),0) new7, COALESCE(SUM(blocked),0) blocked FROM bot_users WHERE bot_id=?""",
           (now - 86400, now - 7 * 86400, now - 30 * 86400, now - 7 * 86400, b["id"])) or {}
    pays = q1("SELECT COUNT(*) n FROM bot_pay WHERE bot_id=? AND status='paid'", (b["id"],)) or {}
    return {"users": r.get("total", 0), "d1": r.get("d1", 0), "d7": r.get("d7", 0), "d30": r.get("d30", 0), "new7": r.get("new7", 0),
            "blocked": r.get("blocked", 0), "msgs_in": b["msgs_in"], "msgs_out": b["msgs_out"], "stars": b["stars_in"], "pays": pays.get("n", 0)}


def bot_out(b, role, full=False):
    u = fresh(b["id"]) or {}
    d = {"id": b["id"], "name": u.get("name") or "", "username": u.get("username") or "", "avatar": u.get("avatar") or "",
         "enabled": bool(b["enabled"]), "role": role, "verified": (u.get("vtier") or "") in ("blue", "major", "official"),
         "created": b["created"], "alive": bot_alive(b), "stats": bot_stats(b)}
    if full:
        n = (q1("SELECT COUNT(*) n FROM bot_updates WHERE bot_id=?", (b["id"],)) or {}).get("n", 0)
        d.update(about=b["about"], cmds=bot_cmds(b), menu_kb=json_load(b["menu_kb"], []), privacy=bool(b["privacy"]),
                 groups_ok=bool(b["groups_ok"]), hook={"url": b["hook_url"], "err": b["hook_err"], "err_ts": b["hook_err_ts"], "pending": n})
        if role == "owner":
            d["token"] = bot_token_of(b)
            d["admins"] = [public_mini_bot(r["uid"]) for r in qa("SELECT uid FROM bot_admins WHERE bot_id=? ORDER BY ts", (b["id"],))]
        else:
            d["owner_user"] = public_mini_bot(b["owner"])
        pays = qa("SELECT * FROM bot_pay WHERE bot_id=? ORDER BY id DESC LIMIT 30", (b["id"],))
        d["pays"] = [{"id": r["id"], "uid": r["uid"], "who": public_mini_bot(r["uid"]), "amount": r["amount"], "title": r["title"], "ts": r["ts"],
                      "status": r["status"]} for r in pays]
    return d


def public_mini_bot(uid):
    t = fresh(uid) or {}
    return {"id": uid, "name": t.get("name") or "", "surname": t.get("surname") or "", "username": t.get("username") or "", "avatar": t.get("avatar") or ""}


def bot_info_out(uid):
    """Что видят люди в профиле бота: описание, «о боте», команды, кнопки меню."""
    b = bot_row(uid)
    if not b:
        return None
    return {"about": b["about"], "cmds": bot_cmds(b), "menu": json_load(b["menu_kb"], []), "off": 0 if b["enabled"] else 1,
            "groups": bool(b["groups_ok"])}


def api_base():
    env = os.environ.get("PUBLIC_API", "").strip().rstrip("/")
    if env:
        return env
    proto = (request.headers.get("X-Forwarded-Proto") or request.scheme).split(",")[0].strip()
    return f"{proto}://{request.host}"


# ───────────── Dicebot (системный бот для создания ботов) ─────────────
DICEBOT_CMDS = [("start", "Главное меню"), ("miniapp", "Открыть панель управления ботами"), ("createbot", "Создать нового бота"),
                ("mybots", "Список ваших ботов"), ("setname", "Изменить название бота"),
                ("setabouttext", "Изменить «О боте»"), ("setuserpic", "Установить аватар бота"), ("token", "Получить API-токен"),
                ("revoke", "Заменить токен"), ("deletebot", "Удалить бота"), ("documention", "Документация Bot API (Python)")]
_dstate = {}


def dicebot_id():
    if _dicebot_cache[0]:
        return _dicebot_cache[0]
    r = q1("SELECT id FROM users WHERE number=?", (DICEBOT_NUMBER,))
    if not r:
        with db_lock:
            r = q1("SELECT id FROM users WHERE number=?", (DICEBOT_NUMBER,))
            if not r:
                now = int(time.time())
                try:
                    uid = run("INSERT INTO users(number,name,username,created,bot,vtier,bio,last_seen) VALUES(?,?,?,?,1,'blue',?,?)",
                              (DICEBOT_NUMBER, DICEBOT_NAME, DICEBOT_USER, now, "Создание и управление ботами Dicegram", now)).lastrowid
                except sqlite3.IntegrityError:
                    uid = run("INSERT INTO users(number,name,username,created,bot,vtier,bio,last_seen) VALUES(?,?,?,?,1,'blue',?,?)",
                              (DICEBOT_NUMBER, DICEBOT_NAME, "", now, "Создание и управление ботами Dicegram", now)).lastrowid
                run("INSERT INTO bots(id,owner,tok_hash,tok_enc,created,cmds,descr,about) VALUES(?,?,?,?,?,?,?,?)",
                    (uid, 0, secrets.token_hex(32), encrypt_text(secrets.token_hex(16)), now,
                     json.dumps([{"command": c, "description": d} for c, d in DICEBOT_CMDS], ensure_ascii=False),
                     "Dicebot — здесь создают ботов для Dicegram: получают токен, настраивают имя, описание и аватар, управляют ботом и читают документацию Bot API.",
                     "Создание и управление ботами"))
                r = {"id": uid}
    _dicebot_cache[0] = r["id"]
    return r["id"]


def md_code(text):
    """Текст с ```блоками``` и `кодом` → (чистый текст, entities кода)."""
    out, ents, n = [], [], 0

    def emit(s, code):
        nonlocal n
        if code and s:
            ents.append({"t": "c", "o": n, "l": utf16len(s)})
        out.append(s)
        n += utf16len(s)
    for i, part in enumerate(re.split(r"```(?:[a-z]+)?\n?(.*?)```", text, flags=re.S)):
        if i % 2:
            emit(part.strip("\n"), True)
        else:
            for j, seg in enumerate(re.split(r"`([^`\n]+)`", part)):
                emit(seg, j % 2 == 1)
    return "".join(out), ents


def dm(uid, text, kb=None, plain=False):
    """Сообщение от Dicebot человеку."""
    if plain:
        t, ents = text, []
    else:
        t, ents = md_code(text)
    return add_message(dicebot_id(), uid, t[:4000], None, "text", ents[:200], None, None, extra={"bot": 1, "kb": kb})


def dm_edit(row, text, kb=None):
    t, ents = md_code(text)
    return bot_edit_row(row, t[:4000], ents[:200], kb or None, True, mark=False)


def kb_start():
    return [[{"t": "🚀 Открыть панель", "a": "dicebot"}],
            [{"t": "➕ Создать бота", "d": "cb:new"}, {"t": "🤖 Мои боты", "d": "cb:my"}],
            [{"t": "📚 Документация", "a": "dicebot:docs"}]]


def d_start(u, arg=""):
    dm(u["id"], "👋 Привет! Я Dicebot — здесь создают ботов для Dicegram и управляют ими.\n\n"
                "/createbot — создать нового бота\n/mybots — список ваших ботов\n/miniapp — удобная панель управления\n"
                "/token — получить токен · /revoke — заменить токен\n"
                "/setname · /setabouttext · /setuserpic — оформление бота\n"
                "/deletebot — удалить бота\n/documention — документация Bot API с примерами на Python", kb_start())


def d_miniapp(u, arg=""):
    dm(u["id"], "📱 Панель Dicebot: все ваши боты, токены, настройки, статистика и платежи звёздами — в одном окне.",
       [[{"t": "🚀 Нажмите, чтобы открыть", "a": "dicebot"}]])


def d_create_begin(u, arg=""):
    cnt = (q1("SELECT COUNT(*) n FROM bots WHERE owner=?", (u["id"],)) or {}).get("n", 0)
    lim = BOT_LIMIT
    if cnt >= lim:
        return dm(u["id"], f"Достигнут лимит: не больше {lim} ботов на один аккаунт. Удалите ненужного бота (/deletebot).")
    _dstate[u["id"]] = {"k": "cb_name", "ts": time.time()}
    dm(u["id"], "Как назвать бота? Это имя увидят люди в списке чатов, например «Мой помощник».\n\nОтмена: /cancel", plain=True)


def d_bots_kb(u, prefix, with_new=True):
    rows = [[{"t": "🤖 " + (fresh(b["id"]) or {}).get("name", "") + "  @" + ((fresh(b["id"]) or {}).get("username") or ""), "d": f"{prefix}:{b['id']}"}]
            for b in bots_of(u["id"])[:30]]
    if with_new:
        rows.append([{"t": "➕ Создать бота", "d": "cb:new"}])
    return rows


def d_mybots(u, arg=""):
    bs = bots_of(u["id"])
    if not bs:
        return dm(u["id"], "У вас пока нет ботов. Создайте первого — это займёт полминуты.", [[{"t": "➕ Создать бота", "d": "cb:new"}]])
    dm(u["id"], f"🤖 Ваши боты ({len(bs)}). Выберите, чтобы управлять:", d_bots_kb(u, "b"))


def d_bot_card(u, b, role):
    t = fresh(b["id"]) or {}
    st = bot_stats(b)
    text = (f"🤖 {t.get('name', '')} · @{t.get('username', '')}\nID: {b['id']}\nСтатус: {'включён' if b['enabled'] else '⛔ отключён'}"
            f"{' · на связи' if bot_alive(b) else ' · не на связи'}\nПользователей: {st['users']} · сообщений: {st['msgs_in']}/{st['msgs_out']}"
            f"\nЗаработано звёзд: {st['stars']} ⭐")
    kb = []
    if role == "owner":
        kb.append([{"t": "🔑 Токен", "d": f"tk:{b['id']}"}, {"t": "♻️ Заменить токен", "d": f"rv:{b['id']}"}])
    kb += [[{"t": "✏️ Название", "d": f"pk:setname:{b['id']}"}, {"t": "ℹ️ О боте", "d": f"pk:setabouttext:{b['id']}"}],
           [{"t": "🖼 Аватар", "d": f"pk:setuserpic:{b['id']}"}],
           [{"t": "▶️ Включить" if not b["enabled"] else "⛔ Отключить", "d": f"tg:{b['id']}"}]]
    if role == "owner":
        kb[-1].append({"t": "🗑 Удалить", "d": f"dl:{b['id']}"})
    kb += [[{"t": "🚀 Панель бота", "a": f"dicebot:bot:{b['id']}"}], [{"t": "‹ Назад", "d": "cb:my"}]]
    return text, kb


def d_token_msg(uid, b, token, new=False):
    t = fresh(b["id"]) or {}
    dm(uid, f"{'✅ Бот создан!' if new == 'created' else '🔑 Новый токен' if new else '🔑 Токен'} @{t.get('username', '')}:\n\n`{token}`\n\n"
            "Храните токен в секрете: любой, у кого он есть, управляет ботом. Если токен утёк — /revoke.",
       [[{"t": "📚 Документация", "a": "dicebot:docs"}, {"t": "🚀 Панель бота", "a": f"dicebot:bot:{b['id']}"}]])


def d_pick(u, cmd, arg=""):
    owner_only = cmd in ("token", "revoke", "deletebot")
    bs = [x for x in bots_of(u["id"]) if not owner_only or x["role"] == "owner"]
    if not bs:
        return dm(u["id"], "У вас пока нет ботов. Создайте первого:", [[{"t": "➕ Создать бота", "d": "cb:new"}]])
    rows = [[{"t": "🤖 " + (fresh(b["id"]) or {}).get("name", "") + "  @" + ((fresh(b["id"]) or {}).get("username") or ""), "d": f"pk:{cmd}:{b['id']}"}]
            for b in bs[:30]]
    what = {"setname": "изменить название", "setabouttext": "изменить «О боте»", "setuserpic": "поставить аватар",
            "token": "получить токен", "revoke": "заменить токен", "deletebot": "удалить"}[cmd]
    dm(u["id"], f"Выберите бота, чтобы {what}:", rows)


def d_begin_set(u, cmd, b):
    uid = u["id"]
    if cmd == "setname":
        _dstate[uid] = {"k": "set_name", "bot": b["id"], "ts": time.time()}
        return dm(uid, "Пришлите новое название бота (до 64 символов). Отмена: /cancel", plain=True)
    if cmd == "setabouttext":
        _dstate[uid] = {"k": "set_about", "bot": b["id"], "ts": time.time()}
        return dm(uid, "Пришлите информацию «О боте» — она показывается в профиле бота (до 200 символов). Чтобы убрать — «-». Отмена: /cancel", plain=True)
    if cmd == "setuserpic":
        _dstate[uid] = {"k": "set_pic", "bot": b["id"], "ts": time.time()}
        return dm(uid, "Пришлите фото — оно станет аватаром бота. Чтобы убрать аватар — отправьте «-». Отмена: /cancel", plain=True)
    if cmd == "token":
        return d_token_msg(uid, b, bot_token_of(b))
    if cmd == "revoke":
        return dm(uid, "Заменить токен? Старый токен перестанет работать сразу — бота придётся перезапустить с новым.",
                  [[{"t": "✅ Да, заменить", "d": f"rvy:{b['id']}"}, {"t": "Отмена", "d": f"b:{b['id']}"}]])
    if cmd == "deletebot":
        t = fresh(b["id"]) or {}
        return dm(uid, f"Удалить бота @{t.get('username', '')}? Это нельзя отменить: токен, настройки и история платежей будут потеряны.",
                  [[{"t": "🗑 Да, удалить", "d": f"dly:{b['id']}"}, {"t": "Отмена", "d": f"b:{b['id']}"}]])


def d_state_text(u, st, text):
    uid, k = u["id"], st["k"]
    if k == "cb_name":
        name = " ".join(text.split())
        if not (1 <= len(name) <= 64):
            return dm(uid, "Название: от 1 до 64 символов. Попробуйте ещё раз или /cancel.", plain=True)
        if name.lower() in BOT_BAD_NAMES and not is_admin(u):
            return dm(uid, "Это название нельзя использовать. Придумайте другое.", plain=True)
        _dstate[uid] = {"k": "cb_user", "name": name, "ts": time.time()}
        return dm(uid, "Теперь username бота. Он должен заканчиваться на «bot», например my_helper_bot (латиница, цифры, _; от 5 до 32 символов).", plain=True)
    if k == "cb_user":
        b, token, e = bot_create(u, st["name"], text)
        if e:
            return dm(uid, e + "\n\nПопробуйте другой username или /cancel.", plain=True)
        _dstate.pop(uid, None)
        return d_token_msg(uid, b, token, "created")
    sb = bot_managed(uid, st.get("bot"))
    if not sb:
        _dstate.pop(uid, None)
        return dm(uid, "Бот не найден.", plain=True)
    b = sb[0]
    t = fresh(b["id"]) or {}
    if k == "set_name":
        name = " ".join(text.split())
        if not (1 <= len(name) <= 64) or (name.lower() in BOT_BAD_NAMES and not is_admin(u)):
            return dm(uid, "Название: от 1 до 64 символов, не «Dicegram»/«Dicebot»/«Telegram». Попробуйте ещё или /cancel.", plain=True)
        run("UPDATE users SET name=? WHERE id=?", (name, b["id"]))
        res = f"✅ Название изменено: {name}"
    elif k == "set_about":
        run("UPDATE bots SET about=? WHERE id=?", ("" if text == "-" else text[:BOT_ABOUT_MAX], b["id"]))
        res = "✅ Информация «О боте» обновлена" if text != "-" else "✅ Информация убрана"
    elif k == "set_pic":
        if text != "-":
            return dm(uid, "Пришлите именно фото (или «-», чтобы убрать аватар). Отмена: /cancel", plain=True)
        drop_photo(t.get("avatar"))
        run("UPDATE users SET avatar='' WHERE id=?", (b["id"],))
        res = "✅ Аватар убран"
    else:
        _dstate.pop(uid, None)
        return
    _dstate.pop(uid, None)
    notify_profile(b["id"])
    dm(uid, res + f" · @{t.get('username', '')}", [[{"t": "🤖 К боту", "d": f"b:{b['id']}"}]])


def d_set_pic(u, st, row):
    uid = u["id"]
    sb = bot_managed(uid, st.get("bot"))
    _dstate.pop(uid, None)
    if not sb:
        return dm(uid, "Бот не найден.", plain=True)
    b = sb[0]
    fid = row.get("fid")
    try:
        with open(file_path(fid), "rb") as fh:
            raw = fh.read(2_000_001)
        if len(raw) > 2_000_000:
            raise ValueError("Фото слишком большое (до 2 МБ)")
        ext = ("jpg" if raw[:3] == b"\xff\xd8\xff" else "png" if raw[:8] == b"\x89PNG\r\n\x1a\n"
               else "webp" if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP" else None)
        if not ext:
            raise ValueError("Нужно фото в формате JPG, PNG или WebP")
        fname = f"{b['id']}_{secrets.token_hex(6)}.{ext}"
        with open(os.path.join(AVATAR_DIR, fname), "wb") as fh:
            fh.write(raw)
    except (OSError, ValueError, TypeError) as e:
        return dm(uid, f"Не получилось: {e}. Пришлите другое фото или /cancel.", plain=True)
    drop_photo((fresh(b["id"]) or {}).get("avatar"))
    run("UPDATE users SET avatar=? WHERE id=?", (fname, b["id"]))
    notify_profile(b["id"])
    dm(uid, "✅ Аватар обновлён", [[{"t": "🤖 К боту", "d": f"b:{b['id']}"}]])


# ── документация (одни и те же тексты — в чате с Dicebot и в окне «Документация») ──
DOC_SECTIONS = [
    ("start", "Быстрый старт", """Bot API Dicegram устроен так же, как Bot API Telegram: те же названия методов, те же поля, тот же формат ответа. Бот живёт на вашем сервере (или бесплатном хостинге) и обращается к нашему адресу.

**Как это работает**
1. Напишите @Dicebot → /createbot → получите токен.
2. Ваша программа вызывает методы по адресу:
`{API}/bot<ТОКЕН>/<метод>`
3. Люди находят бота по @username и пишут ему — вы получаете сообщения и отвечаете.

**Проверка токена**
```
curl "{API}/bot123456:AA…/getMe"
```
Ответ: {"ok": true, "result": {"id": …, "is_bot": true, "username": "my_helper_bot"}}

Ответ на любой запрос — JSON: при успехе `ok: true` и `result`, при ошибке `ok: false`, `error_code`, `description`.

Токен — секрет. Если он утёк, выполните /revoke: старый перестанет работать сразу."""),
    ("python", "Бот на Python за 2 минуты", """Нужен только пакет `requests` (pip install requests).

```
import requests

TOKEN = "123456:AA…"                  # токен из @Dicebot → /token
API = "{API}/bot" + TOKEN

def call(method, **params):
    r = requests.post(f"{API}/{method}", json=params, timeout=70)
    data = r.json()
    if not data.get("ok"):
        raise RuntimeError(data.get("description"))
    return data["result"]

offset = 0
while True:                                   # long polling
    for upd in call("getUpdates", offset=offset, timeout=30):
        offset = upd["update_id"] + 1         # подтверждаем обработанное
        msg = upd.get("message")
        if msg and msg.get("text"):
            chat_id = msg["chat"]["id"]
            if msg["text"].startswith("/start"):
                call("sendMessage", chat_id=chat_id, text="Привет! Я бот на Dicegram 👋",
                     reply_markup={"inline_keyboard": [[{"text": "Нажми меня", "callback_data": "hi"}]]})
            else:
                call("sendMessage", chat_id=chat_id, text="Вы написали: " + msg["text"])
        cb = upd.get("callback_query")
        if cb:
            call("answerCallbackQuery", callback_query_id=cb["id"], text="Привет!")
            call("sendMessage", chat_id=cb["message"]["chat"]["id"], text="Кнопка нажата")
```
Бот может писать человеку только после того, как тот написал боту первым.

Запускайте скрипт где угодно: на своём компьютере, VPS или бесплатном хостинге. Пока скрипт работает, бот «на связи»."""),
    ("libs", "aiogram, python-telegram-bot, pyTelegramBotAPI", """Привычные библиотеки работают, если указать наш адрес вместо адреса Telegram — меняется одна строка.

**aiogram 3**
```
from aiogram import Bot, Dispatcher
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.client.telegram import TelegramAPIServer
from aiogram.filters import CommandStart
from aiogram.types import Message
import asyncio

session = AiohttpSession(api=TelegramAPIServer.from_base("{API}"))
bot = Bot("123456:AA…", session=session)
dp = Dispatcher()

@dp.message(CommandStart())
async def start(m: Message):
    await m.answer("Привет!")

asyncio.run(dp.start_polling(bot))
```
**python-telegram-bot**
```
from telegram.ext import ApplicationBuilder
app = (ApplicationBuilder().token("123456:AA…")
       .base_url("{API}/bot").base_file_url("{API}/file/bot").build())
```
**pyTelegramBotAPI (telebot)**
```
import telebot
telebot.apihelper.API_URL = "{API}/bot{0}/{1}"
telebot.apihelper.FILE_URL = "{API}/file/bot{0}/{1}"
bot = telebot.TeleBot("123456:AA…")
```
Поддерживаются методы из раздела «Список методов». Возможности, которых у Dicegram пока нет (inline-режим, игры, платёжные провайдеры кроме звёзд), вернут ошибку."""),
    ("kb", "Кнопки и клавиатуры", """**Кнопки под сообщением (inline)** — параметр `reply_markup`:
```
{"inline_keyboard": [
  [{"text": "Да", "callback_data": "yes"}, {"text": "Нет", "callback_data": "no"}],
  [{"text": "Сайт", "url": "https://example.com"}],
  [{"text": "Мини-приложение", "web_app": {"url": "https://example.com/app"}}]
]}
```
Нажатие на кнопку с callback_data приходит как `callback_query`. Ответьте на него через `answerCallbackQuery` (можно с текстом `text` и `show_alert`), а сообщение измените через `editMessageText` / `editMessageReplyMarkup`.

**Обычная клавиатура** (кнопки вместо поля ввода):
```
{"keyboard": [["Купить", "Помощь"], ["Контакты"]], "resize_keyboard": true, "one_time_keyboard": false}
```
Нажатая кнопка отправляет её текст как обычное сообщение. Убрать клавиатуру: `{"remove_keyboard": true}`.

**Команды с автодополнением** — `setMyCommands`:
```
call("setMyCommands", commands=[{"command": "start", "description": "Начать"}, {"command": "help", "description": "Помощь"}])
```
Когда человек вводит «/», Dicegram предлагает эти команды.

**Форматирование** — `parse_mode`: "HTML" (<b>, <i>, <u>, <s>, <code>, <a href>, <tg-spoiler>, <blockquote>) или "MarkdownV2".

**Фото, видео, файлы** — `sendPhoto`, `sendVideo`, `sendDocument`, `sendAudio`, `sendVoice`, `sendAnimation`: передайте file_id, ссылку https или загрузите файл (multipart)."""),
    ("hook", "Webhook вместо getUpdates", """Если у бота есть публичный HTTPS-адрес, Dicegram сам отправляет обновления на него.

```
call("setWebhook", url="https://example.com/hook", secret_token="my_secret_123")
```
Dicegram делает POST с JSON-обновлением и заголовком `X-Telegram-Bot-Api-Secret-Token` (проверяйте его). Ответьте кодом 200 — иначе обновление придёт повторно (до 12 попыток).

Пример на Flask:
```
from flask import Flask, request
app = Flask(__name__)

@app.post("/hook")
def hook():
    if request.headers.get("X-Telegram-Bot-Api-Secret-Token") != "my_secret_123":
        return "", 403
    upd = request.get_json()
    msg = upd.get("message")
    if msg and msg.get("text"):
        call("sendMessage", chat_id=msg["chat"]["id"], text="Получил: " + msg["text"])
    return "ok"
```
Пока webhook включён, getUpdates недоступен. Отключить: `deleteWebhook`. Состояние: `getWebhookInfo`.

Адрес должен быть HTTPS и указывать на публичный сервер (адреса внутренней сети запрещены)."""),
    ("stars", "Платежи звёздами и донаты", """Бот может принимать оплату звёздами ⭐ — это валюта `XTR`. Звёзды сразу попадают на баланс владельца бота (комиссии нет) — в «Профиль → Звёзды».

**1. Отправьте счёт**
```
call("sendInvoice", chat_id=chat_id, title="Донат", description="Поддержать автора ⭐",
     payload="donate_50", currency="XTR", prices=[{"label": "Донат", "amount": 50}])
```
Человек увидит карточку счёта с кнопкой «Оплатить ⭐50». В `prices` ровно один пункт, сумма от 1 до 100 000.

**2. Подтвердите оплату** — в течение 10 секунд ответьте на `pre_checkout_query`:
```
pcq = upd.get("pre_checkout_query")
if pcq:
    call("answerPreCheckoutQuery", pre_checkout_query_id=pcq["id"], ok=True)
    # отказать: ok=False, error_message="Товар закончился"
```
**3. Выдайте товар** — после списания приходит сообщение с полем `successful_payment`:
```
msg = upd.get("message")
if msg and msg.get("successful_payment"):
    pay = msg["successful_payment"]      # total_amount, invoice_payload, telegram_payment_charge_id
    call("sendMessage", chat_id=msg["chat"]["id"], text=f"Спасибо за {pay['total_amount']} ⭐!")
```
**Возврат**
```
call("refundStarPayment", user_id=msg["from"]["id"], telegram_payment_charge_id=pay["telegram_payment_charge_id"])
```
Деньги вернутся покупателю с баланса владельца (на нём должно хватать звёзд).

**Выплата людям** (расширение Dicegram — в Telegram такого метода нет): бот, который принимает звёзды, может и отдавать их — например, выводить выигрыш или выдавать награды.
```
call("transferStars", user_id=msg["from"]["id"], amount=100, idempotency_key="reward_42")
```
Звёзды списываются с баланса владельца бота. `idempotency_key` обязателен: повтор запроса с тем же ключом ничего не выплатит второй раз — это защищает от двойной выплаты при сбое сети. Платить можно только тем, кто уже написал боту; на бота действует лимит выплат за 24 часа.

**Важно:** бот должен быть «на связи» (работает getUpdates или webhook), иначе оплата невозможна. Свою статистику смотрите в панели Dicebot → бот → «Платежи»; `getMyStarBalance` и `getStarTransactions` тоже работают.

**Донат-бот целиком** — отправляйте счёт на команду /donate и благодарите в `successful_payment`: это ~15 строк поверх примера «Бот на Python»."""),
    ("methods", "Список методов", """getMe · getUpdates · setWebhook · deleteWebhook · getWebhookInfo
sendMessage · sendPhoto · sendVideo · sendDocument · sendAudio · sendVoice · sendAnimation · sendChatAction
editMessageText · editMessageCaption · editMessageReplyMarkup · deleteMessage
answerCallbackQuery · sendInvoice · answerPreCheckoutQuery · refundStarPayment · transferStars · getStarTransactions · getMyStarBalance
setMyCommands · getMyCommands · deleteMyCommands · setMyName · getMyName · setMyDescription · getMyDescription · setMyShortDescription · getMyShortDescription
getChat · getChatMember · getFile

Файлы входящих сообщений: `getFile(file_id)` → `file_path`, скачать: `{API}/file/bot<ТОКЕН>/<file_path>`.

Группы: добавьте бота в группу — он получает команды (/cmd, /cmd@имя_бота), упоминания и ответы на свои сообщения (режим приватности включён по умолчанию; отключить можно в панели бота)."""),
    ("limits", "Лимиты и безопасность", """• До {LIMIT} ботов на аккаунт.
• До 40 запросов в секунду на бота; в один чат — не больше 30 сообщений за 10 секунд.
• Бот не может писать первым: только тем, кто уже написал ему. Если человек заблокировал бота — ошибка 403.
• Бот видит только свои переписки: личные сообщения ему и группы, где он состоит. Чужие диалоги недоступны.
• getUpdates: одновременно одно подключение (иначе 409). Необработанные обновления хранятся 24 часа.
• Файлы — до {MAXMB} МБ.
• Токен хранится в зашифрованном виде; /revoke заменяет его мгновенно.
• Администраторы Dicegram могут ограничить бота за спам и нарушения. Нельзя выдавать себя за Dicegram, Dicebot или другие сервисы."""),
]


def doc_text(sid):
    for i, t, body_ in DOC_SECTIONS:
        if i == sid:
            return t, body_.replace("{API}", api_base()).replace("{LIMIT}", str(BOT_LIMIT)).replace("{MAXMB}", str(MAX_UPLOAD // 1048576))
    return None, None


def d_docs(u, arg=""):
    dm(u["id"], "📚 Документация Bot API Dicegram\n\nМетоды называются так же, как в Telegram Bot API, поэтому готовые библиотеки "
                "(aiogram, python-telegram-bot, telebot) работают после замены адреса. Откройте полную документацию или выберите раздел:",
       [[{"t": "📖 Открыть документацию", "a": "dicebot:docs"}],
        [{"t": "🚀 Быстрый старт", "d": "doc:start"}, {"t": "🐍 Python", "d": "doc:python"}],
        [{"t": "📦 Библиотеки", "d": "doc:libs"}, {"t": "🔘 Кнопки", "d": "doc:kb"}],
        [{"t": "🔔 Webhook", "d": "doc:hook"}, {"t": "⭐ Платежи звёздами", "d": "doc:stars"}],
        [{"t": "📋 Методы", "d": "doc:methods"}, {"t": "🛡 Лимиты", "d": "doc:limits"}]])


def d_cancel(u, arg=""):
    had = _dstate.pop(u["id"], None)
    dm(u["id"], "Отменено." if had else "Нечего отменять.", plain=True)


D_COMMANDS = {"start": d_start, "help": d_start, "miniapp": d_miniapp, "createbot": d_create_begin, "newbot": d_create_begin,
              "mybots": d_mybots, "cancel": d_cancel, "documention": d_docs, "documentation": d_docs, "docs": d_docs, "doc": d_docs,
              "setname": lambda u, a: d_pick(u, "setname"),
              "setabouttext": lambda u, a: d_pick(u, "setabouttext"), "setuserpic": lambda u, a: d_pick(u, "setuserpic"),
              "token": lambda u, a: d_pick(u, "token"), "revoke": lambda u, a: d_pick(u, "revoke"),
              "deletebot": lambda u, a: d_pick(u, "deletebot")}


def dicebot_handle(u, mid):
    """Человек написал Dicebot: команда или ответ на вопрос (название, описание, фото…)."""
    row = q1("SELECT * FROM messages WHERE id=?", (mid,))
    if not row or not hit("dicebot", u["id"], 25, 30):
        return
    uid = u["id"]
    st = _dstate.get(uid)
    if st and time.time() - st["ts"] > 900:
        st = _dstate.pop(uid, None)
    kind = row.get("kind") or "text"
    if kind == "photo" and st and st["k"] == "set_pic":
        return d_set_pic(u, st, row)
    if kind != "text":
        return dm(uid, "Пришлите текстом или выберите команду: /start", plain=True)
    text = decrypt_text(row["text"]).strip()
    if not text:
        return
    if text.startswith("/"):
        m = re.match(r"^/([A-Za-z0-9_]+)(?:@\w+)?\s*(.*)$", text, re.S)
        fn = D_COMMANDS.get(m.group(1).lower()) if m else None
        _dstate.pop(uid, None)
        if fn:
            return fn(u, m.group(2).strip())
        return dm(uid, "Не знаю такой команды. Откройте меню: /start", plain=True)
    if st:
        return d_state_text(u, st, text)
    d_start(u)


def dicebot_cb(u, row, data):
    """Нажатие кнопки под сообщением Dicebot. Возвращает текст всплывающей подсказки."""
    uid = u["id"]
    p = data.split(":")
    k = p[0]
    if k == "cb":
        if p[1] == "new":
            d_create_begin(u)
        else:
            bs = bots_of(uid)
            if bs:
                dm_edit(row, f"🤖 Ваши боты ({len(bs)}). Выберите, чтобы управлять:", d_bots_kb(u, "b"))
            else:
                dm_edit(row, "У вас пока нет ботов. Создайте первого — это займёт полминуты.", [[{"t": "➕ Создать бота", "d": "cb:new"}]])
        return ""
    if k == "doc":
        t, body_ = doc_text(p[1] if len(p) > 1 else "")
        if not t:
            return "Раздел не найден"
        dm(uid, f"📘 {t}\n\n" + body_.replace("**", ""))
        return ""
    bid = num(p[-1], 1, 2 ** 62) if k != "pk" else num(p[2] if len(p) > 2 else "", 1, 2 ** 62)
    owner_only = k in ("tk", "rv", "rvy", "dl", "dly") or (k == "pk" and len(p) > 1 and p[1] in ("token", "revoke", "deletebot"))
    sb = bot_managed(uid, bid or 0, owner_only)
    if not sb:
        return "Бот не найден или нет доступа"
    b, role = sb
    if k == "b":
        text, kb = d_bot_card(u, b, role)
        dm_edit(row, text, kb)
        return ""
    if k == "tk":
        d_token_msg(uid, b, bot_token_of(b))
        return ""
    if k == "rv":
        d_begin_set(u, "revoke", b)
        return ""
    if k == "rvy":
        token = bot_new_token(b)
        d_token_msg(uid, b, token, True)
        return "Токен заменён"
    if k == "tg":
        run("UPDATE bots SET enabled=? WHERE id=?", (0 if b["enabled"] else 1, b["id"]))
        b = bot_row(b["id"])
        text, kb = d_bot_card(u, b, role)
        dm_edit(row, text, kb)
        return "Бот включён" if b["enabled"] else "Бот отключён"
    if k == "dl":
        d_begin_set(u, "deletebot", b)
        return ""
    if k == "dly":
        un = (fresh(b["id"]) or {}).get("username", "")
        bot_delete(b)
        dm_edit(row, f"🗑 Бот @{un} удалён.", [[{"t": "🤖 Мои боты", "d": "cb:my"}]])
        return "Бот удалён"
    if k == "pk":
        d_begin_set(u, p[1], b)
        return ""
    return "Кнопка устарела"


# ───────────── API панели управления (мини-приложение Dicebot) ─────────────
def need_user():
    u = auth_user()
    if not u:
        return None, err("Требуется вход", 401)
    if u.get("bot"):
        return None, err("Недоступно для ботов", 403)
    return u, None


@app.get("/api/dicebot/bots")
def dbp_bots():
    u, e = need_user()
    if e:
        return e
    return jsonify(ok=True, bots=[bot_out(b, b["role"]) for b in bots_of(u["id"])], limit=BOT_LIMIT, dicebot=dicebot_id())


@app.post("/api/dicebot/create")
def dbp_create():
    u, e = need_user()
    if e:
        return e
    d = body()
    b, token, er = bot_create(u, d.get("name"), d.get("username"))
    if er:
        return err(er)
    return jsonify(ok=True, bot=bot_out(b, "owner", True), token=token)


@app.get("/api/dicebot/username")
def dbp_username():
    u, e = need_user()
    if e:
        return e
    un = str(request.args.get("u") or "").strip().lstrip("@")
    er = bot_username_err(un, u) if un else "Введите username"
    return jsonify(ok=True, free=not er, error=er or "")


@app.get("/api/dicebot/docs")
def dbp_docs():
    u, e = need_user()
    if e:
        return e
    return jsonify(ok=True, sections=[{"id": i, "title": t, "body": b_.replace("{LIMIT}", str(BOT_LIMIT)).replace("{MAXMB}", str(MAX_UPLOAD // 1048576))}
                                      for i, t, b_ in DOC_SECTIONS])


def _managed_or_err(u, bid, owner_only=False):
    sb = bot_managed(u["id"], bid, owner_only)
    if not sb:
        return None, None, err("Бот не найден или нет доступа", 404)
    return sb[0], sb[1], None


@app.get("/api/dicebot/bot/<int:bid>")
def dbp_bot(bid):
    u, e = need_user()
    if e:
        return e
    b, role, e = _managed_or_err(u, bid)
    if e:
        return e
    return jsonify(ok=True, bot=bot_out(b, role, True))


@app.post("/api/dicebot/bot/<int:bid>/update")
def dbp_update(bid):
    u, e = need_user()
    if e:
        return e
    b, role, e = _managed_or_err(u, bid)
    if e:
        return e
    d = body()
    if not hit("dbp_upd", u["id"], 40, 60):
        return err("Слишком часто", 429)
    if "name" in d:
        name = " ".join(str(d["name"]).split())
        if not (1 <= len(name) <= 64):
            return err("Название: от 1 до 64 символов")
        if name.lower() in BOT_BAD_NAMES and not is_admin(u):
            return err("Это название нельзя использовать")
        run("UPDATE users SET name=? WHERE id=?", (name, bid))
    if "about" in d:
        run("UPDATE bots SET about=? WHERE id=?", (str(d["about"]).strip()[:BOT_ABOUT_MAX], bid))
    if "cmds" in d:
        if not isinstance(d["cmds"], list) or len(d["cmds"]) > 100:
            return err("Не больше 100 команд")
        out = []
        for c in d["cmds"]:
            cm, ds = str((c or {}).get("command") or "").lstrip("/").lower(), str((c or {}).get("description") or "").strip()
            if not BOT_CMD_RE.match(cm):
                return err(f"Команда «{cm}»: только a–z, 0–9 и _, до 32 символов")
            if not (3 <= len(ds) <= 256):
                return err(f"Описание команды /{cm}: от 3 до 256 символов")
            out.append({"command": cm, "description": ds})
        run("UPDATE bots SET cmds=? WHERE id=?", (json.dumps(out, ensure_ascii=False), bid))
    if "menu_kb" in d:
        rows = []
        for row in (d["menu_kb"] if isinstance(d["menu_kb"], list) else [])[:10]:
            r = [str(x).strip()[:64] for x in (row if isinstance(row, list) else [])[:6] if str(x).strip()]
            if r:
                rows.append(r)
        run("UPDATE bots SET menu_kb=? WHERE id=?", (json.dumps(rows, ensure_ascii=False) if rows else "", bid))
    if "enabled" in d:
        run("UPDATE bots SET enabled=? WHERE id=?", (1 if d["enabled"] else 0, bid))
        if d["enabled"]:
            hook_kick(bid)
    for k, col in (("privacy", "privacy"), ("groups_ok", "groups_ok")):
        if k in d:
            run(f"UPDATE bots SET {col}=? WHERE id=?", (1 if d[k] else 0, bid))
    notify_profile(bid)
    return jsonify(ok=True, bot=bot_out(bot_row(bid), role, True))


@app.post("/api/dicebot/bot/<int:bid>/avatar")
def dbp_avatar(bid):
    u, e = need_user()
    if e:
        return e
    b, role, e = _managed_or_err(u, bid)
    if e:
        return e
    old = (fresh(bid) or {}).get("avatar")
    data = body().get("data")
    if not data:                                   # убрать аватар
        drop_photo(old)
        run("UPDATE users SET avatar='' WHERE id=?", (bid,))
    else:
        try:
            fname = save_photo(str(bid), data)
        except ValueError as ex:
            return err(str(ex))
        drop_photo(old)
        run("UPDATE users SET avatar=? WHERE id=?", (fname, bid))
    notify_profile(bid)
    return jsonify(ok=True, bot=bot_out(bot_row(bid), role, True))


@app.post("/api/dicebot/bot/<int:bid>/revoke")
def dbp_revoke(bid):
    u, e = need_user()
    if e:
        return e
    b, role, e = _managed_or_err(u, bid, True)
    if e:
        return e
    token = bot_new_token(b)
    return jsonify(ok=True, token=token)


@app.post("/api/dicebot/bot/<int:bid>/hook/delete")
def dbp_hook_delete(bid):
    u, e = need_user()
    if e:
        return e
    b, role, e = _managed_or_err(u, bid)
    if e:
        return e
    m_deleteWebhook(b, None, {"drop_pending_updates": body().get("drop")})
    return jsonify(ok=True, bot=bot_out(bot_row(bid), role, True))


@app.post("/api/dicebot/bot/<int:bid>/delete")
def dbp_delete(bid):
    u, e = need_user()
    if e:
        return e
    b, role, e = _managed_or_err(u, bid, True)
    if e:
        return e
    bot_delete(b)
    return jsonify(ok=True)


def _target_user(ref):
    ref = str(ref or "").strip()
    if not ref:
        return None
    t = user_by_name(ref.lstrip("@")) if not ref.isdigit() else q1("SELECT * FROM users WHERE id=?", (int(ref),))
    if not t or t.get("deleted") or t.get("banned") or t.get("bot") or t.get("is_system"):
        return None
    return t


@app.post("/api/dicebot/bot/<int:bid>/admins")
def dbp_admins(bid):
    u, e = need_user()
    if e:
        return e
    b, role, e = _managed_or_err(u, bid, True)
    if e:
        return e
    d = body()
    if d.get("remove"):
        run("DELETE FROM bot_admins WHERE bot_id=? AND uid=?", (bid, num(d["remove"], 1, 2 ** 62) or 0))
    elif d.get("add"):
        t = _target_user(d["add"])
        if not t:
            return err("Пользователь не найден. Укажите @username человека")
        if t["id"] == u["id"]:
            return err("Вы уже владелец")
        if (q1("SELECT COUNT(*) n FROM bot_admins WHERE bot_id=?", (bid,)) or {}).get("n", 0) >= 5:
            return err("Не больше 5 соуправляющих")
        run("INSERT OR IGNORE INTO bot_admins(bot_id,uid,ts) VALUES(?,?,?)", (bid, t["id"], int(time.time())))
        un = (fresh(bid) or {}).get("username", "")
        try:
            dm(t["id"], f"🤝 {who_label(u)} добавил(а) вас в управление ботом @{un}. Вы можете менять его настройки, но не токен.",
               [[{"t": "🚀 Открыть панель бота", "a": f"dicebot:bot:{bid}"}]])
        except Exception as ex:
            print("bot admin notify:", ex)
    return jsonify(ok=True, bot=bot_out(bot_row(bid), role, True))


@app.post("/api/dicebot/bot/<int:bid>/transfer")
def dbp_transfer(bid):
    u, e = need_user()
    if e:
        return e
    b, role, e = _managed_or_err(u, bid, True)
    if e:
        return e
    t = _target_user(body().get("to"))
    if not t:
        return err("Пользователь не найден. Укажите @username человека")
    if t["id"] == u["id"]:
        return err("Бот уже ваш")
    if (q1("SELECT COUNT(*) n FROM bots WHERE owner=?", (t["id"],)) or {}).get("n", 0) >= BOT_LIMIT:
        return err("У этого человека уже максимум ботов")
    with db_lock:
        run("UPDATE bots SET owner=? WHERE id=?", (t["id"], bid))
        run("DELETE FROM bot_admins WHERE bot_id=? AND uid=?", (bid, t["id"]))
    bot_new_token(bot_row(bid))                    # старый токен прежнего владельца сразу перестаёт работать
    un = (fresh(bid) or {}).get("username", "")
    hc_log(f"🔁 Бот @{un}: {who_label(u)} → {who_label(t)}")
    try:
        dm(t["id"], f"🎁 {who_label(u)} передал(а) вам бота @{un}. Теперь он ваш: токен новый, старый перестал работать.",
           [[{"t": "🚀 Открыть панель бота", "a": f"dicebot:bot:{bid}"}]])
        dm(u["id"], f"✅ Бот @{un} передан: {who_label(t)}.", plain=True)
    except Exception as ex:
        print("bot transfer notify:", ex)
    return jsonify(ok=True)


@app.post("/api/dicebot/bot/<int:bid>/refund")
def dbp_refund(bid):
    u, e = need_user()
    if e:
        return e
    b, role, e = _managed_or_err(u, bid, True)
    if e:
        return e
    r = q1("SELECT * FROM bot_pay WHERE id=? AND bot_id=?", (num(body().get("id"), 1, 2 ** 62) or 0, bid))
    if not r:
        return err("Платёж не найден", 404)
    try:
        m_refundStarPayment(b, None, {"user_id": r["uid"], "telegram_payment_charge_id": r["charge"]})
    except BotErr as ex:
        return err(ex.desc.replace("Bad Request: ", ""))
    return jsonify(ok=True, bot=bot_out(bot_row(bid), role, True), stars=(fresh(u["id"]) or {}).get("stars") or 0)


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


# ───────────────────── УСТОЙЧИВОСТЬ: сбой одного не роняет сервер для всех ─────────────────────
def safe_loop(fn, name):
    """Фоновый цикл (бот, обслуживание, истечение) перезапускается, если он вдруг вылетел."""
    def runner():
        while True:
            try:
                fn()
                return
            except Exception as e:
                print(f"!!! фоновая задача {name} упала: {e!r} — перезапуск через 5 с")
                time.sleep(5)
    return threading.Thread(target=runner, daemon=True, name=name)


AUTOBOTS = [x.strip() for x in os.environ.get("AUTOBOTS", "casino_bot.py").split(",") if x.strip()]   # готовые боты рядом с main.py; AUTOBOTS= (пусто) — не запускать


def autobots_start():
    """Запускает готовых ботов (скрипты в одной папке с main.py) отдельными процессами и поднимает их заново, если упадут.
    Бот ходит в Bot API этого же сервера по 127.0.0.1 — внешняя сеть не нужна. Нет файла — ничего не происходит."""
    import subprocess

    def run_one(name):
        path = os.path.join(BASE, name)
        env = {k: v for k, v in os.environ.items() if k != "BOT_TOKEN"}          # BOT_TOKEN у main.py — токен Telegram-бота, ботам Dicegram он не нужен
        env.update(DG_API=f"http://127.0.0.1:{PORT}", PYTHONUNBUFFERED="1")
        fails = 0
        time.sleep(3)                                                            # сервер должен успеть подняться
        while True:
            t0 = time.time()
            try:
                code = subprocess.Popen([sys.executable, path], cwd=BASE, env=env).wait()
            except Exception as e:
                code = f"не запустился: {e}"
            fails = fails + 1 if time.time() - t0 < 60 else 0
            pause = min(60, 3 * (2 ** min(fails, 4)))
            print(f"!!! бот {name} остановился ({code}) — перезапуск через {pause} с")
            time.sleep(pause)

    for name in AUTOBOTS:
        if os.path.isfile(os.path.join(BASE, name)):
            threading.Thread(target=run_one, args=(name,), daemon=True, name="autobot-" + name).start()
            print(f"i  бот {name} будет запущен вместе с сервером")


def _thread_hook(a):
    if a.exc_type is not SystemExit:
        print(f"!!! ошибка в потоке {getattr(a.thread, 'name', '?')}: {a.exc_type.__name__}: {a.exc_value}")


def supervise():
    """Сторож: сам сервер работает в дочернем процессе. Если он упадёт (нехватка памяти, сбой библиотеки и т.п.),
    сторож сразу запустит его снова — мессенджер не «лежит» у всех из-за одного сбоя. Выключить: SUPERVISE=0."""
    import subprocess, signal
    env = dict(os.environ, DG_CHILD="1", PYTHONUNBUFFERED="1")
    st = {"child": None, "stop": False}

    def on_sig(sig, _frm):
        st["stop"] = True
        c = st["child"]
        if c and c.poll() is None:
            try:
                c.send_signal(sig)
            except Exception:
                pass
    for sg in (signal.SIGTERM, signal.SIGINT):
        try:
            signal.signal(sg, on_sig)
        except Exception:
            pass
    recent = []
    while not st["stop"]:
        st["child"] = subprocess.Popen([sys.executable] + sys.argv, env=env)
        code = st["child"].wait()
        if st["stop"] or code == 0:
            break
        now = time.time()
        recent = [t for t in recent if now - t < 120] + [now]
        pause = 2 if len(recent) < 5 else 20             # падает раз за разом — ждём подольше, чтобы не крутиться впустую
        print(f"!!! сервер остановился (код {code}) — перезапуск через {pause} с")
        time.sleep(pause)
    sys.exit(0)


if __name__ == "__main__" and os.environ.get("DG_CHILD") != "1" and os.environ.get("SUPERVISE", "1") != "0" and os.name == "posix":
    supervise()

if __name__ == "__main__":
    try:
        import faulthandler
        faulthandler.enable()                            # при тяжёлом сбое в лог попадёт, где именно
    except Exception:
        pass
    threading.excepthook = _thread_hook
    init_db()
    if not BOT_APP_LINK:
        print("!!! BOT_APP_LINK не задан: в кнопке бота будет виден WEB_URL. См. README/BotFather /newapp")
    if not TRUST_PROXY:
        print("i  TRUST_PROXY=0: если сервер за прокси хостинга и в «Новый вход» у всех один IP — поставь TRUST_PROXY=1")
    safe_loop(bot_loop, "bot").start()
    bots_boot()
    autobots_start()
    safe_loop(maintenance_loop, "maintenance").start()
    safe_loop(expiry_loop, "expiry").start()
    print(f"Сервер: http://{HOST}:{PORT}")
    app.run(host=HOST, port=PORT, threaded=True)
