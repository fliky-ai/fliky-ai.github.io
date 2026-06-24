// ============ ГЛАВНЫЙ МОДУЛЬ ИНИЦИАЛИЗАЦИИ ПРИЛОЖЕНИЯ ============
console.log('🚀 Скрипт app.js успешно загружен. Ожидание DOM...');

// Глобальные переменные состояния приложения
window.isInitialLoad = true;
window.botCreationStep = null;
window.botName = '';
window.createdBots = [];
window.isConnected = false; // Контроль статуса соединения

document.addEventListener('DOMContentLoaded', () => {
    console.log('📱 DOM готов! Запуск инициализации DICEGRAM...');

    // 1. Восстанавливаем сессию из localStorage ДО коннекта
    const savedUser = localStorage.getItem('dicegram_user');
    if (savedUser && !window.MY_ID) {
        try {
            const user = JSON.parse(savedUser);
            if (user && (user.id || user.telegram_id)) {
                const currentId = String(user.id || user.telegram_id);
                window.MY_ID = currentId;
                window.MY_USERNAME = user.username || '';
                window.tgUser = {
                    id: currentId,
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
    if (typeof window.connectSocket === 'function') {
        window.connectSocket();
    } else {
        console.error('❌ Критическая ошибка: Функция connectSocket не найдена. Проверь socket.js');
        const loadingStatus = document.getElementById('loading-status');
        if (loadingStatus) loadingStatus.textContent = 'Ошибка загрузки сетевого модуля';
    }

    // 3. Настраиваем слушатели событий интерфейса
    initAppEventListeners();
});

// ============ НАСТРОЙКА ВСЕХ СЛУШАТЕЛЕЙ ИНТЕРФЕЙСА ============
function initAppEventListeners() {
    // Отправка сообщения по Enter в текстовом поле
    const messageField = document.getElementById('message-field');
    if (messageField) {
        // Убираем старые клоны слушателей, если они были
        const newMessageField = messageField.cloneNode(true);
        messageField.parentNode.replaceChild(newMessageField, messageField);

        newMessageField.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault(); 
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

    // Глобальный обработчик для ПОИСКА (Фикс пустого экрана)
    const searchInput = document.getElementById('global-search');
    const searchResults = document.getElementById('search-results');
    if (searchInput && searchResults) {
        searchInput.addEventListener('input', function() {
            const query = this.value.trim();
            if (query.length === 0) {
                searchResults.innerHTML = '';
                searchResults.style.display = 'none';
                return;
            }

            // Вызываем глобальный эммит поиска из socket.js / chats.js
            if (window.socket && window.socket.connected) {
                window.socket.emit('search_users', { query: query }, (response) => {
                    searchResults.innerHTML = '';
                    searchResults.style.display = 'block';

                    if (response && response.length > 0) {
                        response.forEach(user => {
                            const div = document.createElement('div');
                            div.className = 'search-item';
                            div.innerHTML = `
                                <div class="search-avatar">${(user.first_name || 'U')[0]}</div>
                                <div class="search-info">
                                    <div class="search-name">${user.first_name}</div>
                                    <div class="search-username">@${user.username || 'id' + user.telegram_id}</div>
                                </div>
                            `;
                            div.onclick = () => {
                                searchResults.style.display = 'none';
                                searchInput.value = '';
                                if (typeof window.openPrivateChat === 'function') {
                                    window.openPrivateChat(user.telegram_id, user.first_name);
                                }
                            };
                            searchResults.appendChild(div);
                        });
                    } else {
                        // ФИКС: Если ничего не найдено, выводим красивую надпись, а не пустоту!
                        searchResults.innerHTML = '<div class="search-empty">Ничего не найдено</div>';
                    }
                });
            }
        });
    }

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

    // Отслеживание возвращения пользователя во вкладку (автореконнект + автообновление чатов)
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) {
            console.log('🔄 Вкладка снова активна. Проверка статуса соединения...');
            if (window.socket && window.socket.connected) {
                // Если сокет живой, просто заново запрашиваем чаты, чтобы подтянуть группы и саппорт
                console.log('🔄 Соединение активно. Обновляем список чатов...');
                window.socket.emit('get_all_chats', {}, (chats) => {
                    if (typeof window.renderChatsList === 'function') {
                        window.renderChatsList(chats);
                    }
                });
            } else if (typeof window.connectSocket === 'function') {
                window.connectSocket();
            }
        }
    });

    console.log('✅ Все слушатели событий успешно привязаны к элементам UI');
}

