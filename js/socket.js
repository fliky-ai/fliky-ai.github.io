// ============ УПРАВЛЕНИЕ СОКЕТОМ ============
let socket = null;
let isConnected = false;
let reconnectAttempts = 0;
let authTimeout = null;

function connectSocket() {
    const loadingStatus = document.getElementById('loading-status');
    const loadingError = document.getElementById('loading-error');
    const reconnectBtn = document.getElementById('reconnect-btn');
    
    loadingStatus.textContent = 'Подключение к серверу...';
    loadingStatus.style.display = 'block';
    loadingError.style.display = 'none';
    reconnectBtn.style.display = 'none';

    console.log('🔌 Подключение к серверу:', CONFIG.SERVER_URL);

    if (socket) {
        socket.disconnect();
        socket = null;
    }

    socket = io(CONFIG.SERVER_URL, { 
        transports: ["websocket", "polling"],
        secure: true,
        reconnection: true,
        reconnectionAttempts: CONFIG.MAX_RECONNECT_ATTEMPTS,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 10000
    });

    socket.on('connect', () => {
        console.log('✅ Socket.IO подключен');
        isConnected = true;
        reconnectAttempts = 0;
        
        const statusEl = document.getElementById('global-status');
        if (statusEl) statusEl.style.display = 'none';
        
        loadingStatus.textContent = 'Авторизация...';
        
        // БЕЗОПАСНОЕ ПОЛУЧЕНИЕ ДАННЫХ ПОЛЬЗОВАТЕЛЯ ИЗ ТЕЛЕГРАМ
        let currentUserData = null;
        if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe) {
            currentUserData = window.Telegram.WebApp.initDataUnsafe.user;
        }
        
        // Если WebApp недоступен (тест в браузере), берем заглушку
        if (!currentUserData) {
            currentUserData = window.tgUser || { id: window.MY_ID || '8771009385', first_name: 'Пользователь', username: 'testuser' };
        }

        console.log('🔑 Отправка данных на авторизацию:', currentUserData);
        
        socket.emit('auth', currentUserData, (response) => {
            console.log('📨 Ответ авторизации:', response);
            
            if (response && response.status === 'ok') {
                console.log('✅ Авторизация успешна');
                loadingStatus.textContent = 'Загрузка...';
                
                if (document.getElementById('loading-screen')) document.getElementById('loading-screen').style.display = 'none';
                if (document.getElementById('app-container')) document.getElementById('app-container').style.display = 'flex';
                
                // Включаем слушатели событий, которые зависят от socket
                setupSocketListeners();
                
                if (window.isInitialLoad) {
                    setTimeout(() => {
                        if (window.loadChatsAndMessages) window.loadChatsAndMessages();
                        if (window.loadContacts) window.loadContacts();
                        window.isInitialLoad = false;
                    }, 500);
                }
            } else {
                console.error('❌ Ошибка авторизации:', response);
                loadingStatus.textContent = 'Ошибка авторизации';
                if (loadingError) loadingError.style.display = 'block';
                if (reconnectBtn) reconnectBtn.style.display = 'block';
            }
        });
    });

    socket.on('connect_error', (error) => {
        console.error('❌ Ошибка подключения:', error);
        reconnectAttempts++;
        
        loadingStatus.textContent = `Ошибка подключения (${reconnectAttempts}/${CONFIG.MAX_RECONNECT_ATTEMPTS})`;
        
        if (reconnectAttempts >= CONFIG.MAX_RECONNECT_ATTEMPTS) {
            if (loadingError) loadingError.style.display = 'block';
            if (reconnectBtn) reconnectBtn.style.display = 'block';
            loadingStatus.textContent = 'Не удалось подключиться';
        }
    });

    socket.on('disconnect', (reason) => {
        console.log('🔌 Отключение:', reason);
        isConnected = false;
        const statusEl = document.getElementById('global-status');
        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.innerText = 'Соединение потеряно';
            statusEl.style.color = '#ff3b30';
        }
    });

    socket.on('reconnect', () => {
        console.log('🔄 Переподключено');
        isConnected = true;
        const statusEl = document.getElementById('global-status');
        if (statusEl) statusEl.style.display = 'none';
        if (window.loadChatsAndMessages) window.loadChatsAndMessages();
        if (window.loadContacts) window.loadContacts();
    });

    socket.on('new_message', (msg) => {
        console.log('📩 Новое сообщение:', msg);
        if (window.handleNewMessage) window.handleNewMessage(msg);
    });

    socket.on('user_updated', (data) => {
        console.log('🔄 Обновление пользователя:', data);
        if (data.user_id === window.MY_ID && data.username) {
            window.MY_USERNAME = data.username;
            if (window.initProfile) window.initProfile();
        }
        if (window.loadChatsAndMessages) window.loadChatsAndMessages();
    });

    if (authTimeout) clearTimeout(authTimeout);
    authTimeout = setTimeout(() => {
        if (!isConnected) {
            loadingStatus.textContent = 'Превышено время ожидания';
            if (loadingError) loadingError.style.display = 'block';
            if (reconnectBtn) reconnectBtn.style.display = 'block';
        }
    }, 15000);
}

// Вынесли динамические подписки в отдельную функцию, запускаемую после коннекта
function setupSocketListeners() {
    if (!socket) return;
    
    // Снимаем старые листенеры, чтобы не дублировались
    socket.off('reaction_updated');
    socket.off('message_read');

    socket.on('reaction_updated', (data) => {
        console.log('📢 Обновление реакций:', data);
        if (data.message_id && data.reactions && window.updateReactionDisplayDirect) {
            window.updateReactionDisplayDirect(data.message_id, data.reactions);
        }
    });

    socket.on('message_read', (data) => {
        const msgEl = document.querySelector(`[data-message-id="${data.message_id}"]`);
        if (msgEl) {
            const ticks = msgEl.querySelector('.status-ticks');
            if (ticks) {
                ticks.className = 'status-ticks read';
                ticks.innerHTML = `<svg viewBox="0 0 24 24"><path d="M18 7l-1.41-1.41L10 12.17 7.41 9.59 6 11l4 4zm-4.24 0L12.35 5.59 6 11.94l1.41 1.41z"/><path d="M0 0h24v24H0z" fill="none"/></svg>`;
            }
        }
    });
}

function reconnect() {
    console.log('🔄 Ручное переподключение...');
    reconnectAttempts = 0;
    connectSocket();
}

