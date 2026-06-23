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
                    console.log('✅ Вход выполнен, показываем интерфейс...');

                    // Обновляем глобальные переменные
                    if (response.user) {
                        MY_ID = response.telegram_id;
                        MY_USERNAME = response.user.username || '';
                        window.tgUser = {
                            id: response.telegram_id,
                            first_name: response.user.first_name,
                            username: response.user.username,
                            photo_url: response.user.photo_url || ''
                        };
                        console.log('tgUser обновлён:', window.tgUser);
                    }

                    // Скрываем экран входа и загрузочный экран
                    document.getElementById('login-screen').classList.remove('active');
                    document.getElementById('login-screen').style.display = 'none';
                    document.getElementById('loading-screen').style.display = 'none';

                    // Принудительно показываем основной контейнер
                    const appContainer = document.getElementById('app-container');
                    appContainer.style.display = 'flex';
                    appContainer.style.visibility = 'visible';
                    appContainer.style.opacity = '1';
                    console.log('app-container показан:', appContainer.style.display);

                    // Переключаем на вкладку "Чаты"
                    const chatsTab = document.querySelector('.nav-item.active');
                    if (chatsTab) {
                        // Если есть активная вкладка, оставляем
                    } else {
                        // Иначе выбираем чаты
                        const chatNav = document.querySelector('.nav-item[onclick*="chats"]');
                        if (chatNav) chatNav.click();
                    }

                    // Загружаем данные с задержкой
                    setTimeout(() => {
                        console.log('Инициализация профиля, чатов, контактов...');
                        try {
                            if (window.initProfile) window.initProfile();
                            if (window.loadChatsAndMessages) window.loadChatsAndMessages();
                            if (window.loadContacts) window.loadContacts();
                            document.getElementById('header-title').innerText = 'Чаты';
                        } catch (e) {
                            console.error('Ошибка при инициализации:', e);
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
