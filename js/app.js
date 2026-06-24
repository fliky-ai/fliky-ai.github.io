// ============ ГЛАВНЫЙ МОДУЛЬ ============
console.log('🚀 DICEGRAM загружается...');

// Инициализация
window.isInitialLoad = true;
window.botCreationStep = null;
window.botName = '';
window.createdBots = [];

// Проверяем localStorage и восстанавливаем сессию ДО подключения сокета
const savedUser = localStorage.getItem('dicegram_user');
if (savedUser && !MY_ID) {
    try {
        const user = JSON.parse(savedUser);
        if (user && user.id) {
            MY_ID = user.id;
            MY_USERNAME = user.username || '';
            window.tgUser = {
                id: user.id,
                first_name: user.first_name || 'User',
                username: user.username || '',
                photo_url: user.photo_url || ''
            };
            console.log('👤 Восстановлен пользователь из localStorage (app.js):', MY_ID);
        }
    } catch (e) {
        localStorage.removeItem('dicegram_user');
    }
}

// Если пользователь восстановлен — сразу показываем интерфейс
if (MY_ID) {
    document.getElementById('loading-screen').style.display = 'none';
    const appContainer = document.getElementById('app-container');
    if (appContainer) {
        appContainer.style.display = 'flex';
        appContainer.style.visibility = 'visible';
        appContainer.style.opacity = '1';
    }
    // Загружаем данные после подключения сокета
    setTimeout(() => {
        if (window.initProfile) window.initProfile();
        if (window.loadChatsAndMessages) window.loadChatsAndMessages();
        if (window.loadContacts) window.loadContacts();
    }, 1000);
}

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
