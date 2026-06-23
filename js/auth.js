// ============ АВТОРИЗАЦИЯ ПО НОМЕРУ (ФИНАЛ С ПЕРЕЗАГРУЗКОЙ) ============
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
    // Проверяем localStorage
    const savedUser = localStorage.getItem('dicegram_user');
    if (savedUser) {
        try {
            const user = JSON.parse(savedUser);
            // Восстанавливаем глобальные переменные
            if (user) {
                window.tgUser = {
                    id: user.id,
                    first_name: user.first_name || 'User',
                    username: user.username || '',
                    photo_url: user.photo_url || ''
                };
                MY_ID = user.id;
                MY_USERNAME = user.username || '';
                // Если есть сохранённый пользователь, скрываем вход и показываем приложение
                hideLoginScreen();
                document.getElementById('app-container').style.display = 'flex';
                document.getElementById('loading-screen').style.display = 'none';
                // Загружаем данные
                setTimeout(() => {
                    if (window.initProfile) window.initProfile();
                    if (window.loadChatsAndMessages) window.loadChatsAndMessages();
                    if (window.loadContacts) window.loadContacts();
                }, 300);
                return false; // вход не нужен
            }
        } catch (e) {
            localStorage.removeItem('dicegram_user');
        }
    }

    // Если нет сохранённого пользователя, проверяем Telegram WebApp
    const tg = window.Telegram?.WebApp;
    if (!tg || !tg.initDataUnsafe?.user?.id) {
        showLoginScreen();
        return true;
    }
    return false;
}

// При загрузке страницы проверяем
document.addEventListener('DOMContentLoaded', function() {
    // Если пользователь уже есть в localStorage, вход не показываем
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
        console.error('❌ Элементы входа не найдены!');
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
                    errorEl.textContent = '✅ Вход выполнен!';
                    console.log('✅ Вход выполнен, сохраняем данные и перезагружаем...');

                    // Сохраняем пользователя в localStorage
                    if (response.user) {
                        const userData = {
                            id: response.telegram_id,
                            first_name: response.user.first_name,
                            username: response.user.username,
                            photo_url: response.user.photo_url || ''
                        };
                        localStorage.setItem('dicegram_user', JSON.stringify(userData));
                        console.log('✅ Пользователь сохранён в localStorage');
                    }

                    // Перезагружаем страницу, чтобы применить изменения
                    setTimeout(() => {
                        window.location.reload();
                    }, 500);

                } else {
                    errorEl.textContent = '❌ ' + (response.message || 'Ошибка');
                    console.error('Ошибка входа:', response);
                }
            });
        } else {
            errorEl.textContent = '❌ Нет соединения с сервером';
            confirmBtn.disabled = false;
        }
    });
});

// Функция выхода (очистка localStorage и перезагрузка)
function logout() {
    localStorage.removeItem('dicegram_user');
    window.location.reload();
}

window.showLoginScreen = showLoginScreen;
window.hideLoginScreen = hideLoginScreen;
window.checkLoginRequired = checkLoginRequired;
window.logout = logout;
