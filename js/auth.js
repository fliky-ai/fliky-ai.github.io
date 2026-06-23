// ============ АВТОРИЗАЦИЯ ТОЛЬКО ПО НОМЕРУ ============
let currentPhone = '';

function showLoginScreen() {
    const loginScreen = document.getElementById('login-screen');
    const appContainer = document.getElementById('app-container');
    if (loginScreen) loginScreen.classList.add('active');
    if (appContainer) appContainer.style.display = 'none';
}

function hideLoginScreen() {
    const loginScreen = document.getElementById('login-screen');
    if (loginScreen) {
        loginScreen.classList.remove('active');
        loginScreen.style.display = 'none';
    }
}

function checkLoginRequired() {
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
                console.log('Восстановлен пользователь из localStorage:', MY_ID);
                
                hideLoginScreen();
                const appContainer = document.getElementById('app-container');
                if (appContainer) {
                    appContainer.style.display = 'flex';
                    appContainer.style.visibility = 'visible';
                    appContainer.style.opacity = '1';
                }
                document.getElementById('loading-screen').style.display = 'none';
                
                setTimeout(() => {
                    if (window.initProfile) window.initProfile();
                    if (window.loadChatsAndMessages) window.loadChatsAndMessages();
                    if (window.loadContacts) window.loadContacts();
                }, 300);
                return false;
            }
        } catch (e) {
            localStorage.removeItem('dicegram_user');
        }
    }

    const tg = window.Telegram?.WebApp;
    if (!tg || !tg.initDataUnsafe?.user?.id) {
        showLoginScreen();
        return true;
    }
    return false;
}

document.addEventListener('DOMContentLoaded', function() {
    if (localStorage.getItem('dicegram_user')) {
        return;
    }

    const phoneInput = document.getElementById('login-phone');
    const nextBtn = document.getElementById('login-next-btn');
    const errorEl = document.getElementById('login-error');

    if (!phoneInput || !nextBtn) {
        console.error('Элементы входа не найдены!');
        return;
    }

    phoneInput.addEventListener('input', function(e) {
        let val = this.value.replace(/\D/g, '');
        if (val.length > 3) {
            val = val.slice(0,3) + ' ' + val.slice(3);
        }
        if (val.length > 7) {
            val = val.slice(0,7) + ' ' + val.slice(7);
        }
        this.value = val;
    });

    nextBtn.addEventListener('click', function() {
        const phone = phoneInput.value.replace(/\s/g, '');
        if (phone.length < 9) {
            errorEl.textContent = 'Введите полный номер (9 цифр)';
            return;
        }
        errorEl.textContent = 'Проверка...';
        nextBtn.disabled = true;
        nextBtn.textContent = 'Вход...';

        currentPhone = '+' + phone;
        console.log('Вход по номеру:', currentPhone);

        if (socket && isConnected) {
            socket.emit('auth_phone', { phone: currentPhone }, function(response) {
                nextBtn.disabled = false;
                nextBtn.textContent = 'Войти';
                
                if (response.status === 'ok') {
                    errorEl.textContent = 'Вход выполнен!';
                    console.log('Вход выполнен, открываем интерфейс...');

                    if (response.user) {
                        const userData = {
                            id: response.telegram_id,
                            first_name: response.user.first_name,
                            username: response.user.username,
                            photo_url: response.user.photo_url || ''
                        };
                        localStorage.setItem('dicegram_user', JSON.stringify(userData));
                        console.log('Пользователь сохранён в localStorage');

                        window.tgUser = {
                            id: response.telegram_id,
                            first_name: response.user.first_name,
                            username: response.user.username,
                            photo_url: response.user.photo_url || ''
                        };
                        MY_ID = response.telegram_id;
                        MY_USERNAME = response.user.username || '';
                    }

                    // Показываем интерфейс сразу
                    document.getElementById('login-screen').style.display = 'none';
                    document.getElementById('login-screen').classList.remove('active');
                    document.getElementById('loading-screen').style.display = 'none';
                    
                    const appContainer = document.getElementById('app-container');
                    if (appContainer) {
                        appContainer.style.display = 'flex';
                        appContainer.style.visibility = 'visible';
                        appContainer.style.opacity = '1';
                        console.log('app-container показан');
                    }

                    // Переключаем вкладку "Чаты"
                    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
                    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
                    
                    const chatsNav = document.querySelector('.nav-item[onclick*="chats"]');
                    if (chatsNav) chatsNav.classList.add('active');
                    
                    const screenChats = document.getElementById('screen-chats');
                    if (screenChats) screenChats.classList.add('active');
                    
                    document.getElementById('header-title').innerText = 'Чаты';

                    setTimeout(function() {
                        try {
                            if (window.initProfile) window.initProfile();
                            if (window.loadChatsAndMessages) window.loadChatsAndMessages();
                            if (window.loadContacts) window.loadContacts();
                            console.log('Все данные загружены');
                        } catch (e) {
                            console.error('Ошибка загрузки:', e);
                        }
                    }, 300);

                } else {
                    errorEl.textContent = 'Ошибка: ' + (response.message || 'Номер не найден. Получите номер в боте через /getnumber');
                    console.error('Ошибка входа:', response);
                }
            });
        } else {
            errorEl.textContent = 'Нет соединения с сервером';
            nextBtn.disabled = false;
            nextBtn.textContent = 'Войти';
        }
    });
});

function logout() {
    localStorage.removeItem('dicegram_user');
    window.location.reload();
}

window.showLoginScreen = showLoginScreen;
window.hideLoginScreen = hideLoginScreen;
window.checkLoginRequired = checkLoginRequired;
window.logout = logout;
