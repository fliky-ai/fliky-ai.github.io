const CONFIG = {
    SERVER_URL: "https://a38499-be46.m.jrnm.app",
    CREATOR_ID: "8771009385",
    CREATOR_USERNAME: "dauletbr",
    MAX_RECONNECT_ATTEMPTS: 5,
    VERSION: "1.0.0",
    SUPPORT_ID: "0",
    BOTFATHER_ID: "botfather"
};

const tg = window.Telegram.WebApp;
tg.expand();
tg.ready();

const tgUser = tg.initDataUnsafe?.user || {
    id: 123456789,
    first_name: "Локальный",
    last_name: "Пользователь",
    username: "тест_юзер",
    photo_url: ""
};

const MY_ID = String(tgUser.id);
let MY_USERNAME = tgUser.username || '';
