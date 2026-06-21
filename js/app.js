// ============ ГЛАВНЫЙ МОДУЛЬ ============
console.log('🚀 DICEGRAM загружается...');
console.log('👤 Пользователь:', tgUser.first_name, '@' + MY_USERNAME, 'ID:', MY_ID);

// Инициализация
window.isInitialLoad = true;
window.botCreationStep = null;
window.botName = '';
window.createdBots = [];

// Запуск
initProfile();
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