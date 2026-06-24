// ============ КОНФИГУРАЦИЯ ============
const CONFIG = {
    SERVER_URL: "https://a38499-be46.m.jrnm.app",
    CREATOR_ID: "8771009385",
    CREATOR_USERNAME: "dauletbr",
    SUPPORT_ID: "0",
    BOTFATHER_ID: "botfather",
    MAX_RECONNECT_ATTEMPTS: 5,
    VERSION: "1.0.0"
};

// ============ ПОЛЬЗОВАТЕЛЬ ============
const tg = window.Telegram?.WebApp;
let tgUser = null;
let MY_ID = null;
let MY_USERNAME = '';

// Сначала проверяем localStorage
const savedUser = localStorage.getItem('dicegram_user');
if (savedUser) {
    try {
        const user = JSON.parse(savedUser);
        if (user && user.id) {
            tgUser = {
                id: user.id,
                first_name: user.first_name || 'User',
                username: user.username || '',
                photo_url: user.photo_url || ''
            };
            MY_ID = user.id;
            MY_USERNAME = user.username || '';
            console.log('👤 Восстановлен пользователь из localStorage:', MY_ID);
        }
    } catch (e) {
        localStorage.removeItem('dicegram_user');
    }
}

// Если нет в localStorage, пробуем Telegram WebApp
if (!MY_ID && tg && tg.initDataUnsafe?.user) {
    tg.expand();
    tg.ready();
    tgUser = tg.initDataUnsafe.user;
    MY_ID = String(tgUser.id);
    MY_USERNAME = tgUser.username || '';
    console.log('👤 Пользователь из Telegram:', MY_ID);
}

// Если вообще ничего нет — создаём заглушку (будет autoLogin)
if (!MY_ID) {
    tgUser = {
        id: null,
        first_name: 'Гость',
        username: 'гость',
        photo_url: ''
    };
    MY_ID = null;
    MY_USERNAME = '';
}

console.log('👤 tgUser:', tgUser);
console.log('🆔 MY_ID:', MY_ID);
