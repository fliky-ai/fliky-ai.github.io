// ============ АВТОРИЗАЦИЯ И РЕГИСТРАЦИЯ (ОБНОВЛЕННЫЙ) ============

function autoLogin() {
    console.log('🚀 Старт процесса авторизации...');

    if (typeof socket === 'undefined' || !isConnected) {
        console.log('⏳ Сокет не готов. Ждем...');
        setTimeout(autoLogin, 500);
        return;
    }

    const loadingStatus = document.getElementById('loading-status');

    // 1. Попытка авторизации через Telegram WebApp
    if (window.Telegram?.WebApp?.initDataUnsafe?.user) {
        const user = window.Telegram.WebApp.initDataUnsafe.user;
        if (loadingStatus) loadingStatus.textContent = 'Подключение к DICEGRAM...';
        
        socket.emit('auth', user, (response) => {
            handleAuthResponse(response, user, true);
        });
        return;
    }

    // 2. Попытка через localStorage
    const saved = localStorage.getItem('dicegram_user');
    if (saved) {
        try {
            const user = JSON.parse(saved);
            socket.emit('auth', user, (response) => {
                if (response?.status === 'ok') {
                    handleAuthResponse(response, user, false);
                } else {
                    runAutoAuth();
                }
            });
            return;
        } catch (e) { localStorage.removeItem('dicegram_user'); }
    }

    // 3. Регистрация нового гостя
    runAutoAuth();
}

function runAutoAuth() {
    console.log('🆕 Регистрация нового сессионного аккаунта...');
    const initDataStr = window.Telegram?.WebApp?.initData || '';
    
    socket.emit('auto_auth', { init_data: initDataStr }, (response) => {
        if (response?.status === 'ok') {
            const user = response.user;
            // Сохраняем пользователя
            window.tgUser = { id: String(user.telegram_id), first_name: user.first_name || 'Guest', username: user.username || '' };
            MY_ID = window.tgUser.id;
            localStorage.setItem('dicegram_user', JSON.stringify(window.tgUser));
            
            enterApp();
            
            // ЖЕСТКАЯ ПРОВЕРКА: Если имя похоже на гостевое, сразу вызываем модалку
            const name = user.first_name || '';
            if (!name || name === 'User' || name.startsWith('Guest_')) {
                setTimeout(showWelcomeModal, 800); 
            }
        } else {
            console.error('❌ Ошибка авто-регистрации');
        }
    });
}

function handleAuthResponse(response, user, isTelegram) {
    if (response?.status === 'ok') {
        window.tgUser = { 
            id: String(user.id || user.telegram_id), 
            first_name: response.first_name || user.first_name || 'User',
            username: user.username || ''
        };
        MY_ID = window.tgUser.id;
        localStorage.setItem('dicegram_user', JSON.stringify(window.tgUser));
        
        enterApp();
        
        // Проверка на необходимость смены имени
        if (!window.tgUser.first_name || window.tgUser.first_name === 'User' || window.tgUser.first_name.startsWith('Guest_')) {
            setTimeout(showWelcomeModal, 800);
        }
    } else {
        runAutoAuth();
    }
}

function enterApp() {
    const loader = document.getElementById('loading-screen');
    if (loader) loader.style.display = 'none';
    
    const app = document.getElementById('app-container');
    if (app) {
        app.style.display = 'flex';
        app.style.visibility = 'visible';
    }
    
    // Инициализация модулей
    if (window.initProfile) window.initProfile();
    if (window.loadChatsAndMessages) window.loadChatsAndMessages();
}

function showWelcomeModal() {
    if (typeof showModal !== 'function') {
        console.error('❌ Функция showModal не найдена!');
        return;
    }
    
    showModal({
        title: '👋 Добро пожаловать!',
        subtitle: 'Как вас называть?',
        defaultValue: '',
        placeholder: 'Введите ваше имя...',
        confirmText: 'Сохранить'
    }).then((name) => {
        if (name?.trim()) {
            socket.emit('update_profile', { name: name.trim() }, (res) => {
                if (res?.status === 'ok') {
                    window.tgUser.first_name = name.trim();
                    localStorage.setItem('dicegram_user', JSON.stringify(window.tgUser));
                    if (typeof showAlert === 'function') showAlert('✅ Имя сохранено!');
                }
            });
        }
    });
}

// Экспорт
window.autoLogin = autoLogin;
window.showWelcomeModal = showWelcomeModal;
window.logout = () => { localStorage.removeItem('dicegram_user'); window.location.reload(); };
