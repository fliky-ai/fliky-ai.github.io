// ============ АВТОРИЗАЦИЯ ПО НОМЕРУ (С КНОПКОЙ ВХОДА) ============
let loginStep = 'phone';
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
    const codeInput = document.getElementById('login-code');
    const codeField = document.getElementById('login-code-field');
    const nextBtn = document.getElementById('login-next-btn');
    const confirmBtn = document.getElementById('login-confirm-btn');
    const backBtn = document.getElementById('login-back-btn');
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
            errorEl.textContent = 'Введите полный номер (9999999цифр)';
            return;
        }
        errorEl.textContent = '';
        currentPhone = '+' + phone;
        loginStep = 'code';
        phoneInput.disabled = true;
        codeField.style.display = 'block';
        nextBtn.style.display = 'none';
        confirmBtn.style.display = 'block';
        backBtn.style.display = 'block';
        codeInput.focus();
        errorEl.textContent = 'Код отправлен в Telegram бот. Используйте /getcode';
    });

    backBtn.addEventListener('click', function() {
        loginStep = 'phone';
        phoneInput.disabled = false;
        codeField.style.display = 'none';
        nextBtn.style.display = 'block';
        confirmBtn.style.display = 'none';
        backBtn.style.display = 'none';
        codeInput.value = '';
        errorEl.textContent = '';
        phoneInput.focus();
    });

    confirmBtn.addEventListener('click', function() {
        const code = codeInput.value.trim();
        if (code.length !== 5) {
            errorEl.textContent = 'Введите 5-значный код';
            return;
        }
        errorEl.textContent = 'Проверка...';
        confirmBtn.disabled = true;

        if (socket && isConnected) {
            socket.emit('auth_phone', { phone: currentPhone, code: code }, function(response) {
                confirmBtn.disabled = false;
                if (response.status === 'ok') {
                    errorEl.textContent = 'Вход выполнен!';
                    console.log('Вход выполнен, сохраняем данные...');

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

                    // Скрываем поле для кода и показываем кнопку "Войти в аккаунт"
                    document.getElementById('login-code-field').style.display = 'none';
                    document.getElementById('login-confirm-btn').style.display = 'none';
                    document.getElementById('login-back-btn').style.display = 'none';
                    
                    // Создаём кнопку "Войти в аккаунт", если её ещё нет
                    let enterBtn = document.getElementById('enter-account-btn');
                    if (!enterBtn) {
                        enterBtn = document.createElement('button');
                        enterBtn.id = 'enter-account-btn';
                        enterBtn.className = 'login-btn primary';
                        enterBtn.textContent = 'Войти в аккаунт';
                        enterBtn.style.width = '100%';
                        enterBtn.style.marginTop = '10px';
                        document.querySelector('.login-actions').appendChild(enterBtn);
                    }
                    enterBtn.style.display = 'block';
                    
                    // Обработчик нажатия на кнопку
                    enterBtn.onclick = function() {
                        console.log('Пользователь нажал "Войти в аккаунт"');
                        
                        // ПРИНУДИТЕЛЬНО ПОКАЗЫВАЕМ ИНТЕРФЕЙС
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
                    };

                } else {
                    errorEl.textContent = 'Ошибка: ' + (response.message || 'Неизвестная ошибка');
                    console.error('Ошибка входа:', response);
                }
            });
        } else {
            errorEl.textContent = 'Нет соединения с сервером';
            confirmBtn.disabled = false;
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
