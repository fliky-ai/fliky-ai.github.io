// ============ ГЛАВНЫЙ МОДУЛЬ ============
console.log('🚀 DICEGRAM загружается...');

// Инициализация
window.isInitialLoad = true;
window.botCreationStep = null;
window.botName = '';
window.createdBots = [];

// Флаг для отслеживания инициализации профиля
let profileInitialized = false;

// Запуск
setTimeout(() => {
    // Если есть tgUser и он настоящий — загружаем профиль
    const tg = window.Telegram?.WebApp;
    if (tg && tg.initDataUnsafe?.user?.id) {
        // Есть Telegram пользователь
        setTimeout(function() {
            if (window.initProfile) {
                window.initProfile();
                profileInitialized = true;
            }
        }, 1000);
    } else {
        // Нет tgUser — autoLogin запустится из socket.js
        console.log('⏳ Ожидаем autoLogin...');
        // Даём время autoLogin выполниться
        setTimeout(function() {
            if (!profileInitialized && window.initProfile) {
                console.log('🔄 Принудительная проверка профиля...');
                window.initProfile();
                profileInitialized = true;
            }
        }, 3000);
    }
}, 500);

connectSocket();

// События
document.getElementById('message-field').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') sendMessage();
});

document.addEventListener('click', function(e) {
    const searchInput = document.getElementById('global-search');
    const results = document.getElementById('search-results');
    if (searchInput && results) {
        if (!searchInput.contains(e.target) && !results.contains(e.target)) {
            results.style.display = 'none';
        }
    }
    const actions = document.getElementById('message-actions');
    if (actions && !actions.contains(e.target)) {
        actions.classList.remove('active');
    }
});

document.getElementById('profile-popup').addEventListener('click', function(e) {
    if (e.target === this) {
        closeProfilePopup();
    }
});

document.addEventListener('visibilitychange', function() {
    if (!document.hidden && !isConnected) {
        console.log('🔄 Восстановление соединения...');
        connectSocket();
    }
});
