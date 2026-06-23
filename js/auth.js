// ============ АВТОРИЗАЦИЯ ПО НОМЕРУ ============
let loginStep = 'phone';
let currentPhone = '';

function showLoginScreen() {
    const loginScreen = document.getElementById('login-screen');
    const appContainer = document.getElementById('app-container');
    loginScreen.classList.add('active');
    appContainer.style.display = 'none';
}

function hideLoginScreen() {
    const loginScreen = document.getElementById('login-screen');
    loginScreen.classList.remove('active');
    // app-container показываем отдельно после успешного входа
}

function checkLoginRequired() {
    const tg = window.Telegram?.WebApp;
    if (!tg || !tg.initDataUnsafe?.user?.id) {
        showLoginScreen();
        return true;
    }
    return false;
}

// Инициализация обработчиков после загрузки DOM
document.addEventListener('DOMContentLoaded', function() {
    const phoneInput = document.getElementById('login-phone');
    const codeInput = document.getElementById('login-code');
    const codeField = document.getElementById('login-code-field');
    const nextBtn = document.getElementById('login-next-btn');
    const confirmBtn = document.getElementById('login-confirm-btn');
    const backBtn = document.getElementById('login-back-btn');
    const errorEl = document.getElementById('login-error');

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
                    errorEl.textContent = '✅ Вход выполнен!';

                    // Сохраняем данные пользователя
                    if (response.user) {
                        MY_ID = response.telegram_id;
                        MY_USERNAME = response.user.username || '';
                        // Обновляем глобальный tgUser (используется в других модулях)
                        if (window.tgUser) {
                            window.tgUser.id = response.telegram_id;
                            window.tgUser.first_name = response.user.first_name;
                            window.tgUser.username = response.user.username;
                            window.tgUser.photo_url = response.user.photo_url || '';
                        } else {
                            window.tgUser = {
                                id: response.telegram_id,
                                first_name: response.user.first_name,
                                username: response.user.username,
                                photo_url: response.user.photo_url || ''
                            };
                        }
                    }

                    // Скрываем экран входа и показываем приложение
                    hideLoginScreen();
                    document.getElementById('app-container').style.display = 'flex';

                    // Загружаем все данные с небольшой задержкой
                    setTimeout(() => {
                        if (window.initProfile) window.initProfile();
                        if (window.loadChatsAndMessages) window.loadChatsAndMessages();
                        if (window.loadContacts) window.loadContacts();
                        // Дополнительно обновляем заголовок
                        const headerTitle = document.getElementById('header-title');
                        if (headerTitle) headerTitle.innerText = 'Чаты';
                    }, 300);

                } else {
                    errorEl.textContent = '❌ ' + (response.message || 'Ошибка');
                }
            });
        } else {
            errorEl.textContent = '❌ Нет соединения с сервером';
            confirmBtn.disabled = false;
        }
    });
});

// Экспортируем функции
window.showLoginScreen = showLoginScreen;
window.hideLoginScreen = hideLoginScreen;
window.checkLoginRequired = checkLoginRequired;
