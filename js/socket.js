// ============ СЕТЕВОЕ ПОДКЛЮЧЕНИЕ И СОКЕТЫ ============
let socket = null;
let isConnected = false;

function initSocket() {
    console.log('🔌 Инициализация Socket.io...');
    
    const serverUrl = window.CONFIG?.SERVER_URL || 'http://localhost:5000';
    socket = io(serverUrl, {
        transports: ['websocket'],
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000
    });

    socket.on('connect', () => {
        console.log('🟢 Подключено к серверу DICEGRAM!');
        isConnected = true;
        window.isConnected = true;

        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) loadingScreen.style.display = 'none';

        // Проверяем сохраненную сессию
        const savedUser = localStorage.getItem('dicegram_user');
        if (savedUser) {
            try {
                const user = JSON.parse(savedUser);
                if (user && user.id) {
                    window.MY_ID = user.id;
                    window.MY_USERNAME = user.username;
                    
                    // Перекидываем сразу в приложение, если авторизован
                    showAuthScreen('main');
                    if (typeof initProfile === 'function') initProfile();
                    return;
                }
            } catch (e) {
                localStorage.removeItem('dicegram_user');
            }
        }

        // Если сессии нет — принудительно открываем экран выбора "Войти / Создать аккаунт"
        showAuthScreen('choice');
    });

    socket.on('disconnect', () => {
        console.log('🔴 Соединение с сервером разорвано');
        isConnected = false;
        window.isConnected = false;
        
        const statusEl = document.getElementById('global-status');
        if (statusEl) {
            statusEl.innerText = "Соединение разорвано...";
            statusEl.style.display = 'inline';
        }
    });

    socket.on('connect_error', (error) => {
        console.error('⚠️ Ошибка подключения:', error);
        const errEl = document.getElementById('loading-error');
        const reconnectBtn = document.getElementById('reconnect-btn');
        if (errEl) errEl.style.display = 'block';
        if (reconnectBtn) reconnectBtn.style.display = 'block';
    });

    window.socket = socket;
}

function reconnect() {
    const errEl = document.getElementById('loading-error');
    const reconnectBtn = document.getElementById('reconnect-btn');
    if (errEl) errEl.style.display = 'none';
    if (reconnectBtn) reconnectBtn.style.display = 'none';
    
    if (socket) {
        socket.connect();
    } else {
        initSocket();
    }
}

// Запуск сокетов при загрузке скрипта
document.addEventListener('DOMContentLoaded', () => {
    initSocket();
});

window.initSocket = initSocket;
window.reconnect = reconnect;

