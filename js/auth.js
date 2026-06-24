// ============ АВТОМАТИЧЕСКАЯ АВТОРИЗАЦИЯ ============

function autoLogin() {
    console.log('🚀 Автоматический вход...');

    if (!socket || !isConnected) {
        console.log('⏳ Ожидание подключения...');
        setTimeout(autoLogin, 1000);
        return;
    }

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
                }, 500);
                return;
            }
        } catch (e) {
            localStorage.removeItem('dicegram_user');
        }
    }

    console.log('🆕 Создаём нового пользователя...');
    socket.emit('auto_auth', {}, function(response) {
        console.log('📨 Ответ auto_auth:', response);
        
        if (response && response.status === 'ok') {
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
            console.log('👤 Имя:', user.first_name);
            console.log('🏷️ Username:', user.username);
            
            document.getElementById('loading-screen').style.display = 'none';
            const appContainer = document.getElementById('app-container');
            if (appContainer) {
                appContainer.style.display = 'flex';
                appContainer.style.visibility = 'visible';
                appContainer.style.opacity = '1';
                console.log('✅ app-container показан');
            }
            
            // Показываем приветствие
            setTimeout(function() {
                // Проверяем, есть ли имя в БД
                if (window.initProfile) {
                    window.initProfile(function(profileData) {
                        const firstName = profileData?.first_name || user.first_name || '';
                        if (!firstName || firstName === 'User' || firstName === 'Пользователь' || firstName.startsWith('Guest_')) {
                            showWelcomeModal();
                        }
                    });
                }
                
                if (window.loadChatsAndMessages) window.loadChatsAndMessages();
                if (window.loadContacts) window.loadContacts();
            }, 500);
            
        } else {
            console.error('❌ Ошибка автоматического входа:', response);
            document.getElementById('loading-status').textContent = 'Ошибка входа';
        }
    });
}

// ============ ПРИВЕТСТВЕННОЕ МОДАЛЬНОЕ ОКНО ============
function showWelcomeModal() {
    console.log('👋 Показываем приветствие для нового пользователя');
    
    showModal({
        title: '👋 Добро пожаловать в DICEGRAM!',
        subtitle: 'Как вас называть? Это имя будет отображаться в вашем профиле.',
        defaultValue: '',
        placeholder: 'Введите ваше имя...',
        maxLength: 50,
        confirmText: 'Сохранить',
        cancelText: 'Пропустить'
    }).then((name) => {
        if (name !== null && name.trim()) {
            socket.emit('update_profile', { name: name.trim() }, (response) => {
                if (response && response.status === 'ok') {
                    console.log('✅ Имя сохранено:', name.trim());
                    window.tgUser.first_name = name.trim();
                    const saved = localStorage.getItem('dicegram_user');
                    if (saved) {
                        try {
                            const userData = JSON.parse(saved);
                            userData.first_name = name.trim();
                            localStorage.setItem('dicegram_user', JSON.stringify(userData));
                        } catch(e) {}
                    }
                    if (window.initProfile) window.initProfile();
                    showAlert('✅ Имя сохранено!');
                } else {
                    showAlert('❌ Ошибка сохранения имени');
                }
            });
        } else {
            console.log('⏭️ Пользователь пропустил ввод имени');
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
