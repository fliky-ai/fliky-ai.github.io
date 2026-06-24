// ============ ГЛАВНЫЙ МОДУЛЬ ИНИЦИАЛИЗАЦИИ ПРИЛОЖЕНИЯ ============
console.log('🚀 Скрипт app.js успешно загружен. Ожидание DOM...');

// Глобальные переменные состояния приложения
window.isInitialLoad = true;
window.botCreationStep = null;
window.botName = '';
window.createdBots = [];

document.addEventListener('DOMContentLoaded', () => {
    console.log('📱 DOM готов! Запуск инициализации DICEGRAM...');

    // 1. Пытаемся восстановить сессию из localStorage ДО коннекта, чтобы подготовить глобальные переменные
    const savedUser = localStorage.getItem('dicegram_user');
    if (savedUser && !window.MY_ID) {
        try {
            const user = JSON.parse(savedUser);
            if (user && user.id) {
                window.MY_ID = String(user.id);
                window.MY_USERNAME = user.username || '';
                window.tgUser = {
                    id: String(user.id),
                    first_name: user.first_name || 'User',
                    username: user.username || '',
                    photo_url: user.photo_url || ''
                };
                console.log('👤 Предварительно восстановлен пользователь (app.js):', window.MY_ID);
            }
        } catch (e) {
            console.error('Ошибка парсинга dicegram_user:', e);
            localStorage.removeItem('dicegram_user');
        }
    }

    // 2. Инициализируем сетевое подключение. 
    // connectSocket сама вызовет цепочку авторизации auth.js после успешного коннекта.
    if (typeof window.connectSocket === 'function') {
        window.connectSocket();
    } else {
        console.error('❌ Критическая ошибка: Функция connectSocket не найдена. Проверь socket.js');
        const loadingStatus = document.getElementById('loading-status');
        if (loadingStatus) loadingStatus.textContent = 'Ошибка загрузки сетевого модуля';
    }

    // 3. Безопасно настраиваем слушатели событий интерфейса
    initAppEventListeners();
});

// ============ НАСТРОЙКА ВСЕХ СЛУШАТЕЛЕЙ ИНТЕРФЕЙСА ============
function initAppEventListeners() {
    // Отправка сообщения по Enter в текстовом поле
    const messageField = document.getElementById('message-field');
    if (messageField) {
        messageField.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault(); // Предотвращаем перенос строки
                if (typeof window.sendMessage === 'function') {
                    window.sendMessage();
                } else {
                    console.warn('⚠️ Функция sendMessage не найдена в контексте.');
                }
            }
        });
    }

    // Глобальный клик: закрытие поиска, контекстных меню и модалок
    document.addEventListener('click', function(e) {
        // Закрытие глобального поиска при клике мимо
        const searchInput = document.getElementById('global-search');
        const results = document.getElementById('search-results');
        if (searchInput && results) {
            if (!searchInput.contains(e.target) && !results.contains(e.target)) {
                results.style.display = 'none';
            }
        }

        // Закрытие панели действий сообщения
        const actionsMenu = document.getElementById('message-actions');
        if (actionsMenu && actionsMenu.classList.contains('active')) {
            if (!e.target.closest('.message-item') && !e.target.closest('.message-actions-content')) {
                actionsMenu.classList.remove('active');
            }
        }
    });

    // Закрытие попапа профиля по клику на тёмную подложку
    const profilePopup = document.getElementById('profile-popup');
    if (profilePopup) {
        profilePopup.addEventListener('click', function(e) {
            if (e.target === this) {
                if (typeof window.closeProfilePopup === 'function') {
                    window.closeProfilePopup();
                }
            }
        });
    }

    // Отслеживание возвращения пользователя во вкладку (автореконнект)
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden && !window.isConnected) {
            console.log('🔄 Вкладка снова активна. Восстановление потерянного соединения...');
            if (typeof window.connectSocket === 'function') {
                window.connectSocket();
            }
        }
    });

    console.log('✅ Все слушатели событий успешно привязаны к элементам UI');
}

