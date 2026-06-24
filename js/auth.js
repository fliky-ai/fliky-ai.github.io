// ============ АВТОМАТИЧЕСКАЯ АВТОРИЗАЦИЯ И РЕГИСТРАЦИЯ ============

function autoLogin() {
    console.log('🚀 Старт автоматического входа...');

    if (!socket || !isConnected) {
        console.log('⏳ Сокет не готов. Ожидание подключения к серверу...');
        setTimeout(autoLogin, 500);
        return;
    }

    const loadingStatus = document.getElementById('loading-status');

    // 1. Сначала проверяем, запущены ли мы внутри реального Telegram WebApp
    if (window.Telegram && window.Telegram.WebApp) {
        const tg = window.Telegram.WebApp;
        if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
            const user = tg.initDataUnsafe.user;
            
            // Важно: сразу отправляем данные авторизации на бэк, чтобы сокет привязал SID к ID юзера!
            if (loadingStatus) loadingStatus.textContent = 'Авторизация в сети Telegram...';
            
            socket.emit('auth', user, (response) => {
                console.log('📨 Ответ Telegram auth:', response);
                if (response && response.status === 'ok') {
                    window.tgUser = {
                        id: String(response.telegram_id || user.id),
                        first_name: user.first_name || 'User',
                        username: user.username || '',
                        photo_url: user.photo_url || ''
                    };
                    MY_ID = String(window.tgUser.id);
                    MY_USERNAME = window.tgUser.username;

                    localStorage.setItem('dicegram_user', JSON.stringify(window.tgUser));
                    enterApp();
                } else {
                    console.error('❌ Бэкенд отклонил авторизацию Telegram');
                    if (loadingStatus) loadingStatus.textContent = 'Ошибка авторизации на сервере';
                }
            });
            return;
        }
    }

    // 2. Если мы в обычном браузере — проверяем локальное хранилище (localStorage)
    const savedUser = localStorage.getItem('dicegram_user');
    if (savedUser) {
        try {
            const user = JSON.parse(savedUser);
            if (user && user.id) {
                if (loadingStatus) loadingStatus.textContent = 'Восстановление сессии...';
                
                // Передаем сохраненного юзера на бэк, чтобы сервер авторизовал этот сокет!
                socket.emit('auth', user, (response) => {
                    console.log('📨 Ответ на восстановление сессии:', response);
                    if (response && response.status === 'ok') {
                        window.tgUser = {
                            id: String(user.id),
                            first_name: user.first_name || 'User',
                            username: user.username || '',
                            photo_url: user.photo_url || ''
                        };
                        MY_ID = String(user.id);
                        MY_USERNAME = user.username || '';
                        enterApp();
                    } else {
                        // Если сервер не знает этот ID, сбрасываем кэш и идем на auto_auth
                        localStorage.removeItem('dicegram_user');
                        runAutoAuth();
                    }
                });
                return;
            }
        } catch (e) {
            localStorage.removeItem('dicegram_user');
        }
    }

    // 3. Если данных нет вообще нигде — запускаем автоматическую регистрацию (GUEST)
    runAutoAuth();
}

// Вынесли в отдельную функцию, чтобы не дублировать код
function runAutoAuth() {
    const loadingStatus = document.getElementById('loading-status');
    if (loadingStatus) loadingStatus.textContent = 'Создание аккаунта...';
    
    console.log('🆕 Создаём нового сессионного пользователя на бэкенде...');
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
            
            localStorage.setItem('dicegram_user', JSON.stringify(window.tgUser));
            console.log('✅ Новый пользователь авторизован на бэке. ID:', MY_ID);
            
            enterApp();
            
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
            if (loadingStatus) loadingStatus.textContent = 'Ошибка регистрации';
        }
    });
}

// ============ ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ ВХОДА В ИНТЕРФЕЙС ============
function enterApp() {
    const loader = document.getElementById('loading-screen');
    if (loader) loader.style.display = 'none';
    
    const appContainer = document.getElementById('app-container');
    if (appContainer) {
        appContainer.style.display = 'flex';
        appContainer.style.visibility = 'visible';
        appContainer.style.opacity = '1';
    }
    
    // Мягко подгружаем данные модулей ПОСЛЕ того как MY_ID точно сел на место
    setTimeout(() => {
        if (window.initProfile) window.initProfile();
        if (window.loadChatsAndMessages) window.loadChatsAndMessages();
        if (window.loadContacts) window.loadContacts();
    }, 100);
}

// ============ ПРИВЕТСТВЕННОЕ МОДАЛЬНОЕ ОКНО ============
function showWelcomeModal() {
    if (typeof showModal !== 'function') return;
    
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
                }
            });
        }
    });
}

function logout() {
    localStorage.removeItem('dicegram_user');
    window.location.reload();
}

window.logout = logout;
window.autoLogin = autoLogin;
window.showWelcomeModal = showWelcomeModal;

