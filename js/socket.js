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

    console.log('Подключение к серверу:', CONFIG.SERVER_URL);

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
        console.log('Socket.IO подключен');
        isConnected = true;
        reconnectAttempts = 0;
        
        const statusEl = document.getElementById('global-status');
        statusEl.style.display = 'none';
        
        loadingStatus.textContent = 'Авторизация...';
        
        // Проверяем, есть ли пользователь Telegram
        const tg = window.Telegram?.WebApp;
        if (tg && tg.initDataUnsafe?.user?.id) {
            // Есть tgUser – авторизуем через auth
            socket.emit('auth', tgUser, (response) => {
                console.log('Ответ авторизации:', response);
                if (response && response.status === 'ok') {
                    console.log('Авторизация успешна');
                    loadingStatus.textContent = 'Загрузка...';
                    document.getElementById('loading-screen').style.display = 'none';
                    document.getElementById('app-container').style.display = 'flex';
                    if (window.isInitialLoad) {
                        setTimeout(() => {
                            if (window.loadChatsAndMessages) window.loadChatsAndMessages();
                            if (window.loadContacts) window.loadContacts();
                            if (window.initProfile) window.initProfile();
                            window.isInitialLoad = false;
                        }, 500);
                    }
                } else {
                    console.error('Ошибка авторизации:', response);
                    loadingStatus.textContent = 'Ошибка авторизации';
                    loadingError.style.display = 'block';
                    reconnectBtn.style.display = 'block';
                }
            });
        } else {
            // Нет tgUser – запускаем автоматический вход
            console.log('Нет tgUser, запускаем autoLogin');
            loadingStatus.textContent = 'Автоматический вход...';
            document.getElementById('loading-screen').style.display = 'none';
            if (window.autoLogin) {
                window.autoLogin();
            } else {
                console.error('autoLogin не найден!');
                loadingStatus.textContent = 'Ошибка: autoLogin не найден';
                loadingError.style.display = 'block';
                reconnectBtn.style.display = 'block';
            }
        }
    });

    socket.on('connect_error', (error) => {
        console.error('Ошибка подключения:', error);
        reconnectAttempts++;
        loadingStatus.textContent = 'Ошибка подключения (' + reconnectAttempts + '/' + CONFIG.MAX_RECONNECT_ATTEMPTS + ')';
        if (reconnectAttempts >= CONFIG.MAX_RECONNECT_ATTEMPTS) {
            loadingError.style.display = 'block';
            reconnectBtn.style.display = 'block';
            loadingStatus.textContent = 'Не удалось подключиться';
        }
    });

    socket.on('disconnect', (reason) => {
        console.log('Отключение:', reason);
        isConnected = false;
        const statusEl = document.getElementById('global-status');
        statusEl.style.display = 'block';
        statusEl.innerText = 'Соединение потеряно';
        statusEl.style.color = '#ff3b30';
    });

    socket.on('reconnect', () => {
        console.log('Переподключено');
        isConnected = true;
        const statusEl = document.getElementById('global-status');
        statusEl.style.display = 'none';
        if (window.loadChatsAndMessages) window.loadChatsAndMessages();
        if (window.loadContacts) window.loadContacts();
    });

    socket.on('new_message', (msg) => {
        console.log('Новое сообщение:', msg);
        if (window.handleNewMessage) window.handleNewMessage(msg);
    });

    socket.on('chats_updated', (data) => {
        console.log('Обновление списка чатов:', data);
        if (window.loadChatsAndMessages) {
            setTimeout(() => window.loadChatsAndMessages(), 300);
        }
        if (data.chat_id && window.openChat) {
            setTimeout(() => {
                if (window.currentChatId !== data.chat_id) {
                    window.openChat(data.chat_id);
                }
            }, 500);
        }
    });

    socket.on('group_joined', (data) => {
        console.log('Присоединение к группе:', data);
        if (window.loadChatsAndMessages) {
            setTimeout(() => window.loadChatsAndMessages(), 300);
        }
        if (data.chat_id && window.openChat) {
            setTimeout(() => {
                window.openChat(data.chat_id);
            }, 500);
        }
    });

    socket.on('user_updated', (data) => {
        console.log('Обновление пользователя:', data);
        if (data.user_id === MY_ID && data.username) {
            MY_USERNAME = data.username;
            if (window.initProfile) window.initProfile();
        }
        if (window.loadChatsAndMessages) window.loadChatsAndMessages();
    });

    socket.on('message_read', (data) => {
        console.log('Сообщение прочитано:', data);
        const msgEl = document.querySelector('[data-message-id="' + data.message_id + '"]');
        if (msgEl) {
            const ticks = msgEl.querySelector('.status-ticks');
            if (ticks) {
                ticks.className = 'status-ticks read';
                ticks.innerHTML = '<svg viewBox="0 0 24 24"><path d="M18 7l-1.41-1.41L10 12.17 7.41 9.59 6 11l4 4zm-4.24 0L12.35 5.59 6 11.94l1.41 1.41z"/><path d="M0 0h24v24H0z" fill="none"/></svg>';
            }
        }
    });

    socket.on('reaction_updated', (data) => {
        console.log('Обновление реакций:', data);
        if (window.updateReactionDisplayDirect) {
            window.updateReactionDisplayDirect(data.message_id, data.reactions);
        }
    });

    socket.on('error', (error) => {
        console.error('Ошибка сокета:', error);
    });

    if (authTimeout) clearTimeout(authTimeout);
    authTimeout = setTimeout(() => {
        if (!isConnected) {
            loadingStatus.textContent = 'Превышено время ожидания';
            loadingError.style.display = 'block';
            reconnectBtn.style.display = 'block';
        }
    }, 15000);
}

function reconnect() {
    console.log('Ручное переподключение...');
    reconnectAttempts = 0;
    connectSocket();
}

console.log('Socket module loaded');
