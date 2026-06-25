// ============ ИНИЦИАЛИЗАЦИЯ И ПОДКЛЮЧЕНИЕ СОКЕТОВ ============
let socket;

// Инициализируем Telegram WebApp SDK, если открыли через Mini App
const tg = window.Telegram ? window.Telegram.WebApp : null;

document.addEventListener("DOMContentLoaded", () => {
    // Разворачиваем Mini App внутри ТГ на максимум
    if (tg) {
        tg.expand();
        tg.ready();
        
        // Передаем данные юзера из ТГ в глобальное состояние (из config.js)
        if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
            tgUser = tg.initDataUnsafe.user;
        }
    }
    
    connectToServer();
});

function connectToServer() {
    // Берем SOCKET_URL прямо из твоего глобального CONFIG
    const serverUrl = CONFIG.SOCKET_URL || "https://a38499-be46.m.jrnm.app";
    
    console.log("🔌 Попытка подключения к серверу сокетов: " + serverUrl);
    
    socket = io(serverUrl, {
        transports: ['websocket', 'polling'],
        reconnectionAttempts: CONFIG.MAX_RECONNECT_ATTEMPTS || 5,
        timeout: 10000
    });

    // Успешный коннект
    socket.on('connect', () => {
        console.log("🟢 Успешно подключено к бэкенду DICEGRAM! ID сессии:", socket.id);
        
        // Прячем загрузочный экран и открываем выбор (Войти / Регистрация)
        document.getElementById("loading-screen").style.display = "none";
        showAuthScreen('choice');
    });

    // Ошибка подключения
    socket.on('connect_error', (error) => {
        console.error("❌ Ошибка сокет-соединения:", error);
        document.getElementById("loader").style.display = "none";
        document.getElementById("loading-error").style.display = "block";
        document.getElementById("reconnect-btn").style.display = "block";
    });

    // Потеря связи с сервером
    socket.on('disconnect', (reason) => {
        console.warn("🔴 Соединение разорвано по причине:", reason);
    });

    // Слушаем приветственный автоответ от DICEGRAM SUPPORT при успешной регистрации
    socket.on('welcome_notification', (data) => {
        alert(`🔔 Сообщение от ${data.sender_name}:\n\n${data.text}`);
    });
}

// Функция ручного перезапуска, если хост долго спал
function reconnect() {
    document.getElementById("loader").style.display = "block";
    document.getElementById("loading-error").style.display = "none";
    document.getElementById("reconnect-btn").style.display = "none";
    if (socket) {
        socket.connect();
    } else {
        connectToServer();
    }
}
