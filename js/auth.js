// ============ АВТОМАТИЧЕСКАЯ АВТОРИЗАЦИЯ ============

function autoLogin() {
    console.log('🚀 Автоматический вход...');

    if (!socket || !isConnected) {
        console.log('⏳ Ожидание подключения...');
        setTimeout(autoLogin, 1000);
        return;
    }

    // Проверяем localStorage
    const savedUser = localStorage.getItem('dicegram_user');
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
                console.log('👤 Восстановлен пользователь из localStorage:', MY_ID);
                
                // Сразу показываем интерфейс
                document.getElementById('loading-screen').style.display = 'none';
                const appContainer = document.getElementById('app-container');
                if (appContainer) {
                    appContainer.style.display = 'flex';
                    appContainer.style.visibility = 'visible';
                    appContainer.style.opacity = '1';
                }
                
                setTimeout(() => {
                    if (window.initProfile) window.initProfile();
                    if (window.loadChatsAndMessages) window.loadChatsAndMessages();
                    if (window.loadContacts) window.loadContacts();
                }, 300);
                return;
            }
        } catch (e) {
            localStorage.removeItem('dicegram_user');
        }
    }

    // Если нет localStorage — запрашиваем у сервера нового пользователя
    console.log('🆕 Создаём нового пользователя...');
    socket.emit('auto_auth', {}, function(response) {
        console.log('📨 Ответ auto_auth:', response);
        
        if (response && response.status === 'ok') {
            // Сохраняем пользователя
            const user = response.user;
            const userData = {
                id: user.telegram_id,
                first_name: user.first_name || 'User',
                username: user.username || '',
                photo_url: user.photo_url || ''
            };
            localStorage.setItem('dicegram_user', JSON.stringify(userData));
            
            window.tgUser = {
                id: user.telegram_id,
                first_name: user.first_name || 'User',
                username: user.username || '',
                photo_url: user.photo_url || ''
            };
            MY_ID = user.telegram_id;
            MY_USERNAME = user.username || '';
            
            console.log('✅ Пользователь создан:', MY_ID);
            
            // Показываем интерфейс
            document.getElementById('loading-screen').style.display = 'none';
            const appContainer = document.getElementById('app-container');
            if (appContainer) {
                appContainer.style.display = 'flex';
                appContainer.style.visibility = 'visible';
                appContainer.style.opacity = '1';
            }
            
            setTimeout(() => {
                if (window.initProfile) window.initProfile();
                if (window.loadChatsAndMessages) window.loadChatsAndMessages();
                if (window.loadContacts) window.loadContacts();
            }, 300);
        } else {
            console.error('❌ Ошибка автоматического входа:', response);
            document.getElementById('loading-status').textContent = 'Ошибка входа';
        }
    });
}

function logout() {
    localStorage.removeItem('dicegram_user');
    window.location.reload();
}

window.logout = logout;
window.autoLogin = autoLogin;
