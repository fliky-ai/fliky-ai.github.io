// ============ УПРАВЛЕНИЕ СОКЕТОМ (SOCKET.IO) ============
let socket = null;
let isConnected = false;
let reconnectAttempts = 0;
let authTimeout = null;

function connectSocket() {
    const loadingStatus = document.getElementById('loading-status');
    const loadingError = document.getElementById('loading-error');
    const reconnectBtn = document.getElementById('reconnect-btn');
    
    if (loadingStatus) {
        loadingStatus.textContent = 'Подключение к серверу DICEGRAM...';
        loadingStatus.style.display = 'block';
    }
    if (loadingError) loadingError.style.display = 'none';
    if (reconnectBtn) reconnectBtn.style.display = 'none';

    // Используем SOCKET_URL из config.js
    const serverUrl = CONFIG.SOCKET_URL || CONFIG.SERVER_URL || window.location.origin;
    console.log('🔌 Инициализация соединения с бэкендом:', serverUrl);

    if (socket) {
        socket.disconnect();
        socket = null;
    }

    // Соединение, оптимизированное под Python-бэк (FastAPI / python-socketio)
    socket = io(serverUrl, { 
        transports: ["websocket", "polling"],
        secure: true,
        reconnection: true,
        reconnectionAttempts: CONFIG.MAX_RECONNECT_ATTEMPTS || 5,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 10000
    });

    // ===== СОБЫТИЕ: УСПЕШНЫЙ КОННЕКТ С СЕРВЕРОМ =====
    socket.on('connect', () => {
        console.log('✅ Сетевой уровень Socket.IO подключен успешно!');
        isConnected = true;
        reconnectAttempts = 0;
        
        const statusEl = document.getElementById('global-status');
        if (statusEl) statusEl.style.display = 'none';
        
        if (loadingStatus) loadingStatus.textContent = 'Авторизация профиля...';
        
        // Передаём управление модулю авторизации auth.js, без дублирования кода!
        if (window.autoLogin) {
            window.autoLogin();
        } else {
            console.error('❌ Критическая ошибка: модуль window.autoLogin не найден!');
            if (loadingStatus) loadingStatus.textContent = 'Ошибка загрузки модулей аутентификации';
        }
    });

    // ===== СОБЫТИЕ: ОШИБКА ПОДКЛЮЧЕНИЯ =====
    socket.on('connect_error', (error) => {
        console.error('❌ Сетевая ошибка Socket.IO:', error);
        reconnectAttempts++;
        
        const maxAttempts = CONFIG.MAX_RECONNECT_ATTEMPTS || 5;
        if (loadingStatus) {
            loadingStatus.textContent = `Ошибка сети. Попытка переподключения (${reconnectAttempts}/${maxAttempts})`;
        }
        
        if (reconnectAttempts >= maxAttempts) {
            if (loadingError) loadingError.style.display = 'block';
            if (reconnectBtn) reconnectBtn.style.display = 'block';
            if (loadingStatus) loadingStatus.textContent = 'Не удалось связаться с сервером';
        }
    });

    // ===== СОБЫТИЕ: ДИСКОННЕКТ =====
    socket.on('disconnect', (reason) => {
        console.warn('🔌 Соединение с сокет-сервером разорвано:', reason);
        isConnected = false;
        
        const statusEl = document.getElementById('global-status');
        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.innerText = '⚠️ Соединение потеряно. Переподключение...';
            statusEl.style.color = '#ff3b30';
        }
    });

    // ===== СОБЫТИЕ: РЕКОННЕКТ (АВТОВОССТАНОВЛЕНИЕ) =====
    socket.on('reconnect', () => {
        console.log('🔄 Соединение автоматически восстановлено!');
        isConnected = true;
        
        const statusEl = document.getElementById('global-status');
        if (statusEl) statusEl.style.display = 'none';
        
        // Перезагружаем контент актуальных экранов
        if (window.loadChatsAndMessages) window.loadChatsAndMessages();
        if (window.loadContacts) window.loadContacts();
    });

    // ===== ВХОДЯЩИЕ ИВЕНТЫ РЕАЛЬНОГО ВРЕМЕНИ =====
    
    // Новое сообщение
    socket.on('new_message', (msg) => {
        console.log('📩 Получено новое сообщение:', msg);
        
        // Рендерим в чат, если он открыт
        if (window.appendMessageToChat && (msg.chat_id === currentChatId || msg.sender_id === currentChatId)) {
            window.appendMessageToChat(msg);
            if (window.scrollToBottom) window.scrollToBottom();
        }
        
        // Обновляем список чатов (превью, поднятие наверх)
        if (window.loadChatsAndMessages) window.loadChatsAndMessages();
    });

    // Обновление профиля/статуса какого-то юзера на сервере
    socket.on('user_updated', (data) => {
        console.log('🔄 Ивент обновления пользователя от сервера:', data);
        if (data && data.user_id === MY_ID) {
            if (data.username) MY_USERNAME = data.username;
            if (window.initProfile) window.initProfile();
        }
        if (window.loadChatsAndMessages) window.loadChatsAndMessages();
    });

    // Таймаут на загрузку
    if (authTimeout) clearTimeout(authTimeout);
    authTimeout = setTimeout(() => {
        if (!isConnected) {
            if (loadingStatus) loadingStatus.textContent = 'Превышено время ожидания сервера (Таймаут)';
            if (loadingError) loadingError.style.display = 'block';
            if (reconnectBtn) reconnectBtn.style.display = 'block';
        }
    }, 15000);
}

function reconnect() {
    console.log('🔄 Запуск ручного переподключения сети...');
    reconnectAttempts = 0;
    connectSocket();
}

// Экспорт в глобальную область видимости
window.connectSocket = connectSocket;
window.reconnect = reconnect;

console.log('✅ Модуль Socket успешно собран и изолирован');
