// ============ АВТОРИЗАЦИЯ ПО НОМЕРУ (ФИНАЛ) ============
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
    const tg = window.Telegram?.WebApp;
    if (!tg || !tg.initDataUnsafe?.user?.id) {
        showLoginScreen();
        return true;
    }
    return false;
}

document.addEventListener('DOMContentLoaded', function() {
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

    // Форматирование номера
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

    // Кнопка "Далее"
    nextBtn.addEventListener('click', function() {
        const phone = phoneInput.value.replace(/\s/g, '');
        if (phone.length < 9) {
            errorEl.textContent = 'Введите полный номер (9 цифр)';
            return;
        }
        errorEl.textContent = '';
        currentPhone = '+' + phone; // "+8888771009385"
        
        loginStep = 'code';
        phoneInput.disabled = true;
        codeField.style.display = 'block';
        nextBtn.style.display = 'none';
        confirmBtn.style.display = 'block';
        backBtn.style.display = 'block';
        codeInput.focus();
        errorEl.textContent = 'Код отправлен в Telegram бот. Используйте /getcode';
    });

    // Кнопка "Изменить"
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

    // Кнопка "Подтвердить"
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
                    errorEl.textContent = '✅ло Вход выполнен!';
                    console.log('✅ ллВход выполнен, открываем интерфейс...');

                    // Обновляем глобальные данные пользователя
                    if (response.user) {
                        MY_ID = response.telegram_id;
                        MY_USERNAME = response.user.username || '';
                        window.tgUser = {
                            id: response.telegram_id,
                            first_name: response.user.first_name,
                            username: response.user.username,
                            photo_url: response.user.photo_url || ''
                        };
                        console.log('tgUser:', window.tgUser);
                    }

                    // Скрываем всё, что может мешать
                    const loginScreen = document.getElementById('login-screen');
                    if (loginScreen) {
                        loginScreen.classList.remove('active');
                        loginScreen.style.display = 'none';
                    }
                    const loadingScreen = document.getElementById('loading-screen');
                    if (loadingScreen) loadingScreen.style.display = 'none';

                    // Показываем основной интерфейс
                    const appContainer = document.getElementById('app-container');
                    if (appContainer) {
                        appContainer.style.display = 'flex';
                        appContainer.style.visibility = 'visible';
                        appContainer.style.opacity = '1';
                        console.log('app-container показан');
                    } else {
                        console.error('❌ app-container не найден!');
                    }

                    // Переключаем вкладку на "Чаты"
                    const navItems = document.querySelectorAll('.nav-item');
                    navItems.forEach(item => item.classList.remove('active'));
                    const chatsNav = document.querySelector('.nav-item[onclick*="chats"]');
                    if (chatsNav) {
                        chatsNav.classList.add('active');
                        const screenChats = document.getElementById('screen-chats');
                        if (screenChats) {
                            document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
                            screenChats.classList.add('active');
                        }
                    }
                    document.getElementById('header-title').innerText = 'Чаты';

                    // Загружаем данные через 500ms
                    setTimeout(() => {
                        try {
                            if (window.initProfile) window.initProfile();
                            if (window.loadChatsAndMessages) window.loadChatsAndMessages();
                            if (window.loadContacts) window.loadContacts();
                            console.log('✅ Все данные загружены');
                        } catch (e) {
                            console.error('Ошибка загрузки:', e);
                        }
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

window.showLoginScreen = showLoginScreen;
window.hideLoginScreen = hideLoginScreen;
window.checkLoginRequired = checkLoginRequired;
