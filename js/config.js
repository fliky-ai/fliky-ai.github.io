// ============ ГЛОБАЛЬНАЯ КОНФИГУРАЦИЯ DICEGRAM ============
const CONFIG = {
    SERVER_URL: "https://a38499-be46.m.jrnm.app",
    SOCKET_URL: "https://a38499-be46.m.jrnm.app", // Для совместимости с socket.js
    CREATOR_ID: "8771009385",
    CREATOR_USERNAME: "dauletbr",
    SUPPORT_ID: "0",
    BOTFATHER_ID: "botfather",
    MAX_RECONNECT_ATTEMPTS: 5,
    VERSION: "1.0.0"
};

// ============ ГЛОБАЛЬНОЕ СОСТОЯНИЕ (ПЕРЕМЕННЫЕ) ============
// Объявляем один раз здесь. В других файлах просто используем их (без let/const)!
let tgUser = null;
let MY_ID = null;
let MY_USERNAME = '';
let currentChatId = null;
let selectedMessageId = null;

// Хранилище активных чатов в текущей сессии
const dynamicChats = {}; 

console.log('⚙️ Конфигурация DICEGRAM успешно загружена. Версия:', CONFIG.VERSION);
