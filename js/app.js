// ============ ГЛАВНЫЙ МОДУЛЬ ============
console.log('🚀 DICEGRAM загружается...');

// ============ ПРОВЕРКА LOCALSTORAGE ПЕРЕД ВСЕМ ============
const savedUser = localStorage.getItem('dicegram_user');
let isUserRestored = false;

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
            isUserRestored = true;
            console.log('👤 Восстановлен пользователь из localStorage:', MY_ID);
            
            // ПРИНУДИТЕЛЬНО СКРЫВАЕМ ЭКРАН ВХОДА СРАЗУ
            const loginScreen = document.getElementById('login-screen');
            if (loginScreen) {
                loginScreen.classList.remove('active');
                loginScreen.style.display = 'none';
            }
            document.getElementById('loading-screen').style.display = 'none';
            
            // ПОКАЗЫВАЕМ ИНТЕРФЕЙС
            const appContainer = document.getElementById('app-container');
            if (appContainer) {
                appContainer.style.display = 'flex';
                appContainer.style.visibility = 'visible';
                appContainer.style.opacity = '1';
            }
        }
    } catch (e) {
        localStorage.removeItem('dicegram_user');
    }
}

console.log('👤 Пользователь:', tgUser?.first_name || 'Неизвестно', '@' + (MY_USERNAME || 'нет'), 'ID:', MY_ID || 'нет');

// Инициализация
window.isInitialLoad = true;
window.botCreationStep = null;
window.botName = '';
window.createdBots = [];

// Запуск
setTimeout(() => {
    if (isUserRestored) {
        // Если пользователь восстановлен из localStorage, сразу загружаем данные
        console.log('🔄 Загрузка данных для восстановленного пользователя...');
        setTimeout(() => {
            if (window.initProfile) window.initProfile();
            if (window.loadChatsAndMessages) window.loadChatsAndMessages();
            if (window.loadContacts) window.loadContacts();
        }, 300);
    } else {
        // Если нет сохранённого пользователя, проверяем Telegram WebApp
        const tg = window.Telegram?.WebApp;
        if (tg && tg.initDataUnsafe?.user?.id) {
            initProfile();
        }
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

// Восстановление после закрытия
document.addEventListener('visibilitychange', function() {
    if (!document.hidden && !isConnected) {
        console.log('🔄 Восстановление соединения...');
        connectSocket();
    }
});
