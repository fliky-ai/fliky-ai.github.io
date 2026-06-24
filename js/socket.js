// ============ УПРАВЛЕНИЕ СОКЕТОМ ============
let socket = null;
let isConnected = false;
let reconnectAttempts = 0;
let authTimeout = null;
let isAuthInProgress = false;

function connectSocket() {
    const loadingStatus = document.getElementById('loading-status');
    const loadingError = document.getElementById('loading-error');
    const reconnectBtn = document.getElementById('reconnect-btn');
    
    loadingStatus.textContent = 'Пооооооодключение к серверу...';
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
        statusEl.style.display = 'none';
        
        loadingStatus.textContent = 'Авторизация...';
        
        // Проверяем, есть ли пользователь в localStorage
        const savedUser = localStorage.getItem('dicegram_user');
        const tg = window.Telegram?.WebApp;
        
        // ===== ВАЖНО: сначала проверяем Telegram, потом localStorage =====
        if (tg && tg.initDataUnsafe?.user?.id) {
            // Пользователь из Telegram
            const tgUserId = String(tg.initDataUnsafe.user.id);
            console.log('👤 Пользователь из Telegram:', tgUserId);
            
            // Проверяем, совпадает ли с localStorage
            if (savedUser) {
                try {
                    const user = JSON.parse(savedUser);
                    if (user && user.id === tgUserId) {
                        // Всё ок, восстанавливаем
                        window.tgUser = {
                            id: user.id,
                            first_name: user.first_name || 'User',
                            username: user.username || '',
                            photo_url: user.photo_url || ''
                        };
                        MY_ID = user.id;
                        MY_USERNAME = user.username || '';
                        console.log('👤 Восстановлен пользователь из localStorage:', MY_ID);
                        
                        // Показываем интерфейс
                        showApp();
                        return;
                    }
                } catch (e) {
                    localStorage.removeItem('dicegram_user');
                }
            }
            
            // Если нет в localStorage — авторизуем через Telegram
            if (!MY_ID) {
                socket.emit('auth', tgUser, (response) => {
                    console.log('📨 Ответ авторизации:', response);
                    
                    if (response && response.status === 'ok') {
                        console.log('✅ Авторизация успешна');
                        const userData = {
                            id: response.telegram_id,
                            first_name: tgUser?.first_name || 'User',
                            username: tgUser?.username || '',
                            photo_url: tgUser?.photo_url || ''
                        };
                        localStorage.setItem('dicegram_user', JSON.stringify(userData));
                        window.tgUser = userData;
                        MY_ID = userData.id;
                        MY_USERNAME = userData.username || '';
                        
                        showApp();
                    } else {
                        console.error('❌ Ошибка авторизации:', response);
                        loadingStatus.textContent = 'Ошибка авторизации';
                        loadingError.style.display = 'block';
                        reconnectBtn.style.display = 'block';
                    }
                });
                return;
            }
        }
        
        // ===== Если нет Telegram — пробуем localStorage =====
        if (savedUser) {
            try {
                const user = JSON.parse(savedUser);
                if (user && user.id) {
                    window.tgUser = {
                        id: user.id,
                        first_name: user.first_name || 'User',
                        username: user.username || '',
                        photo_url: user.photo_url || ''
                    };
                    MY_ID = user.id;
                    MY_USERNAME = user.username || '';
                    console.log('👤 Восстановлен пользователь из localStorage:', MY_ID);
                    
                    showApp();
                    return;
                }
            } catch (e) {
                localStorage.removeItem('dicegram_user');
            }
        }
        
        // ===== Если ничего нет — autoLogin =====
        console.log('🆕 Нет пользователя, запускаем autoLogin');
        loadingStatus.textContent = 'Автоматический вход...';
        if (window.autoLogin) {
            window.autoLogin();
        } else {
            console.error('❌ autoLogin не найден!');
            loadingStatus.textContent = 'Ошибка: autoLogin не найден';
            loadingError.style.display = 'block';
            reconnectBtn.style.display = 'block';
        }
    });

    socket.on('connect_error', (error) => {
        console.error('❌ Ошибка подключения:', error);
        reconnectAttempts++;
        loadingStatus.textContent = 'Ошибка подключения (' + reconnectAttempts + '/' + CONFIG.MAX_RECONNECT_ATTEMPTS + ')';
        if (reconnectAttempts >= CONFIG.MAX_RECONNECT_ATTEMPTS) {
            loadingError.style.display = 'block';
            reconnectBtn.style.display = 'block';
            loadingStatus.textContent = 'Не удалось подключиться';
        }
    });

    socket.on('disconnect', (reason) => {
        console.log('🔌 Отключение:', reason);
        isConnected = false;
        const statusEl = document.getElementById('global-status');
        statusEl.style.display = 'block';
        statusEl.innerText = 'Соединение потеряно';
        statusEl.style.color = '#ff3b30';
    });

    socket.on('reconnect', () => {
        console.log('🔄 Переподключено');
        isConnected = true;
        const statusEl = document.getElementById('global-status');
        statusEl.style.display = 'none';
        if (window.loadChatsAndMessages) window.loadChatsAndMessages();
        if (window.loadContacts) window.loadContacts();
    });

    socket.on('new_message', (msg) => {
        console.log('📩 Новое сообщение:', msg);
        if (window.handleNewMessage) window.handleNewMessage(msg);
    });

    socket.on('user_updated', (data) => {
        console.log('🔄 Обновление пользователя:', data);
        if (data.user_id === MY_ID && data.username) {
            MY_USERNAME = data.username;
            if (window.initProfile) window.initProfile();
        }
        if (window.loadChatsAndMessages) window.loadChatsAndMessages();
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

// ===== ФУНКЦИЯ ПОКАЗА ИНТЕРФЕЙСА =====
function showApp() {
    console.log('🚀 Показываем интерфейс для:', MY_ID);
    
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';
    document.getElementById('app-container').style.visibility = 'visible';
    document.getElementById('app-container').style.opacity = '1';
    
    setTimeout(() => {
        if (window.initProfile) window.initProfile();
        if (window.loadChatsAndMessages) window.loadChatsAndMessages();
        if (window.loadContacts) window.loadContacts();
    }, 500);
}

function reconnect() {
    console.log('🔄 Ручное переподключение...');
    reconnectAttempts = 0;
    connectSocket();
}

console.log('✅ Socket module loaded');
