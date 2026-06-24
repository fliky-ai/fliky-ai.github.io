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

if (tg && tg.initDataUnsafe?.user) {
    tg.expand();
    tg.ready();
    tgUser = tg.initDataUnsafe.user;
    MY_ID = String(tgUser.id);
    MY_USERNAME = tgUser.username || '';
} else {
    // Для браузера и APK — будет создан через autoLogin
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
