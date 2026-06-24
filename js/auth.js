// ============ АВТОМАТИЧЕСКАЯ АВТОРИЗАЦИЯ И РЕГИСТРАЦИЯ ============

function autoLogin() {
    console.log('🚀 Старт автоматического входа...');

    // 1. Жёсткая проверка: сокет должен быть готов
    if (!socket || !isConnected) {
        console.log('⏳ Сокет не готов. Ожидание подключения к серверу...');
        setTimeout(autoLogin, 500);
        return;
    }

    // 2. Сначала проверяем, запущены ли мы внутри реального Telegram WebApp
    if (window.Telegram && window.Telegram.WebApp) {
        const tg = window.Telegram.WebApp;
        if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
            const user = tg.initDataUnsafe.user;
            
            window.tgUser = {
                id: String(user.id),
                first_name: user.first_name || 'User',
                username: user.username || '',
                photo_url: user.photo_url || ''
            };
            MY_ID = String(user.id);
            MY_USERNAME = user.username || '';
            
            console.log('📱 Авторизован через Telegram WebApp ID:', MY_ID);
            
            // Сразу пускаем в приложение
            enterApp();
            return;
        }
    }

    // 3. Если мы в обычном браузере — проверяем локальное хранилище (localStorage)
    const savedUser = localStorage.getItem('dicegram_user');
    if (savedUser) {
        try {
            const user = JSON.parse(savedUser);
            if (user && user.id) {
                window.tgUser = {
                    id: String(user.id),
                    first_name: user.first_name || 'User',
                    username: user.username || '',
                    photo_url: user.photo_url || ''
                };
                MY_ID = String(user.id);
                MY_USERNAME = user.username || '';
                
                console.log('👤 Пользователь восстановлен из localStorage:', MY_ID);
                enterApp();
                return;
            }
        } catch (e) {
            localStorage.removeItem('dicegram_user');
        }
    }

    // 4. Если данных нет вообще нигде — регистрируем нового пользователя через бэкенд
    console.log('🆕 Создаём нового сессионного пользователя на бэкенде...');
    
    // Передаем пустой объект или initData, если сидим через браузер
    const initDataStr = window.Telegram?.WebApp?.initData || '';
    
    socket.emit('auto_auth', { init_data: initDataStr }, function(response) {
        console.log('📨 Ответ сервера на auto_auth:', response);
        
        if (response && response.status === 'ok') {
            const user = response.user;
            
            window.tgUser = {
                id: String(user.telegram_id),
                first_name: user.first_name || 'User',
                username: user.username || '',
                photo_url: user.photo_url || ''
            };
            MY_ID = String(user.telegram_id);
            MY_USERNAME = user.username || '';
            
            // Сохраняем в кэш браузера, чтобы при перезагрузке не плодить юзеров
            localStorage.setItem('dicegram_user', JSON.stringify({
                id: MY_ID,
                first_name: window.tgUser.first_name,
                username: MY_USERNAME,
                photo_url: window.tgUser.photo_url
            }));
            
            console.log('✅ Новый пользователь успешно зарегистрирован. ID:', MY_ID);
            
            enterApp();
            
            // Показываем модалку ввода имени, если имя дефолтное
            setTimeout(() => {
                if (window.initProfile) {
                    window.initProfile(function(profileData) {
                        const firstName = profileData?.first_name || user.first_name || '';
                        if (!firstName || firstName === 'User' || firstName === 'Пользователь' || firstName.startsWith('Guest_')) {
                            showWelcomeModal();
                        }
                    });
                }
            }, 1000);
            
        } else {
            console.error('❌ Ошибка автоматического входа на сервере:', response);
            const statusEl = document.getElementById('loading-status');
            if (statusEl) statusEl.textContent = 'Ошибка авторизации на сервере';
        }
    });
}

// ============ ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ ВХОДА В ИНТЕРФЕЙС ============
function enterApp() {
    // Прячем экран загрузки
    const loader = document.getElementById('loading-screen');
    if (loader) loader.style.display = 'none';
    
    // Показываем главное приложение
    const appContainer = document.getElementById('app-container');
    if (appContainer) {
        appContainer.style.display = 'flex';
        appContainer.style.visibility = 'visible';
        appContainer.style.opacity = '1';
        console.log('✅ Интерфейс DICEGRAM успешно отображен.');
    }
    
    // Мягко подгружаем данные модулей
    setTimeout(() => {
        if (window.initProfile) window.initProfile();
        if (window.loadChatsAndMessages) window.loadChatsAndMessages();
        if (window.loadContacts) window.loadContacts();
    }, 200);
}

// ============ ПРИВЕТСТВЕННОЕ МОДАЛЬНОЕ ОКНО ============
function showWelcomeModal() {
    console.log('👋 Открытие приветственного окна...');
    
    if (typeof showModal !== 'function') {
        console.warn('⚠️ Компонент showModal не найден, пропускаем приветствие.');
        return;
    }
    
    showModal({
        title: '👋 Добро пожаловать в DICEGRAM!',
        subtitle: 'Как вас называть? Это имя будут видеть другие пользователи.',
        defaultValue: window.tgUser?.first_name || '',
        placeholder: 'Введите ваше имя...',
        maxLength: 50,
        confirmText: 'Сохранить',
        cancelText: 'Пропустить'
    }).then((name) => {
        if (name !== null && name.trim()) {
            const cleanName = name.trim();
            socket.emit('update_profile', { name: cleanName }, (response) => {
                if (response && response.status === 'ok') {
                    console.log('✅ Новое имя сохранено в профиле:', cleanName);
                    if (window.tgUser) window.tgUser.first_name = cleanName;
                    
                    const saved = localStorage.getItem('dicegram_user');
                    if (saved) {
                        try {
                            const userData = JSON.parse(saved);
                            userData.first_name = cleanName;
                            localStorage.setItem('dicegram_user', JSON.stringify(userData));
                        } catch(e) {}
                    }
                    if (window.initProfile) window.initProfile();
                    if (typeof showAlert === 'function') showAlert('✅ Имя успешно обновлено!');
                } else {
                    if (typeof showAlert === 'function') showAlert('❌ Не удалось сохранить имя.');
                }
            });
        }
    });
}

function logout() {
    localStorage.removeItem('dicegram_user');
    window.location.reload();
}

// Экспорт функций в глобальный объект window
window.logout = logout;
window.autoLogin = autoLogin;
window.showWelcomeModal = showWelcomeModal;
