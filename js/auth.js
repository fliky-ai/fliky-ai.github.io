// ============ АВТОРИЗАЦИЯ И СЕССИЯ (DICEGRAM) ============

// Функция переключения окон (скрывает/показывает нужные экраны)
function showAuthScreen(type) {
    const choiceScreen = document.getElementById('screen-auth-choice');
    const loginScreen = document.getElementById('screen-auth-login');
    const registerScreen = document.getElementById('screen-auth-register');
    const appContainer = document.getElementById('app-container');
    const loadingScreen = document.getElementById('loading-screen');

    // Прячем абсолютно всё перед переключением
    if (choiceScreen) choiceScreen.style.display = 'none';
    if (loginScreen) loginScreen.style.display = 'none';
    if (registerScreen) registerScreen.style.display = 'none';
    if (appContainer) appContainer.style.display = 'none';
    if (loadingScreen) loadingScreen.style.display = 'none';

    if (type === 'choice') {
        if (choiceScreen) choiceScreen.style.display = 'flex';
    } else if (type === 'login') {
        if (loginScreen) loginScreen.style.display = 'flex';
        clearAuthErrors();
    } else if (type === 'register') {
        if (registerScreen) registerScreen.style.display = 'flex';
        clearAuthErrors();
        autoFillTelegramUsername();
    } else if (type === 'main') {
        if (appContainer) appContainer.style.display = 'block';
    }
}

// Очистка ошибок во всех полях ввода
function clearAuthErrors() {
    const logErr = document.getElementById('login-error-msg');
    const regErr = document.getElementById('reg-error-msg');
    if (logErr) logErr.style.display = 'none';
    if (regErr) regErr.style.display = 'none';
}

// Автоподстановка юзернейма из Telegram WebApp (если открыли как Mini App)
function autoFillTelegramUsername() {
    if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe?.user) {
        const tgUser = window.Telegram.WebApp.initDataUnsafe.user;
        const regInput = document.getElementById('reg-username');
        if (tgUser.username && regInput) {
            regInput.value = tgUser.username;
        }
    }
}

// ============ ОБРАБОТКА РЕГИСТРАЦИИ ============
function processRegister() {
    const usernameInput = document.getElementById('reg-username');
    const passwordInput = document.getElementById('reg-password');
    const confirmInput = document.getElementById('reg-password-confirm');
    const errorEl = document.getElementById('reg-error-msg');

    if (!usernameInput || !passwordInput || !confirmInput || !errorEl) return;

    const username = usernameInput.value.trim().replace('@', '');
    const password = passwordInput.value;
    const confirmPassword = confirmInput.value;

    errorEl.style.display = 'none';

    // 1. Максимальная проверка полей фронтенда
    if (!username) {
        errorEl.innerText = "⚠️ Напишите вашего юзернейм из оригинального телеграмма!";
        errorEl.style.display = 'block';
        return;
    }
    if (!password) {
        errorEl.innerText = "⚠️ Создайте пароль!";
        errorEl.style.display = 'block';
        return;
    }
    if (!confirmPassword) {
        errorEl.innerText = "⚠️ Подтвердите пароля!";
        errorEl.style.display = 'block';
        return;
    }
    if (password !== confirmPassword) {
        errorEl.innerText = "⚠️ Пароли не совпадают!";
        errorEl.style.display = 'block';
        return;
    }

    // Собираем данные Telegram (для Mini App или генерируем мок-данные для обычного приложения)
    let tgId = "ID_" + Math.floor(100000 + Math.random() * 900000);
    let tgFirstName = "Пользователь";

    if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe?.user) {
        const tgUser = window.Telegram.WebApp.initDataUnsafe.user;
        tgId = tgUser.id;
        tgFirstName = tgUser.first_name || "Пользователь";
    }

    if (!window.socket || !window.isConnected) {
        errorEl.innerText = "❌ Нет соединения с сервером!";
        errorEl.style.display = 'block';
        return;
    }

    // Отправляем на бэкенд
    window.socket.emit('register_user', {
        username: username,
        password: password,
        telegram_id: tgId,
        first_name: tgFirstName
    }, (response) => {
        if (response && response.status === 'success') {
            // Сохраняем пользователя в локальную сессию
            const sessionData = {
                id: tgId,
                username: username,
                first_name: tgFirstName
            };
            localStorage.setItem('dicegram_user', JSON.stringify(sessionData));
            window.MY_ID = tgId;
            window.MY_USERNAME = username;

            // Запускаем инициализацию профиля и чатов
            showAuthScreen('main');
            if (typeof initProfile === 'function') initProfile();

            // Выводим сообщение об успешной регистрации
            if (typeof showAlert === 'function') {
                showAlert(`🎉 Вы успешно зарегистрировали своего аккаунта!\n\nВаш айди: ${tgId}\nВаш никнейм: ${tgFirstName}\nВаш юзернейм: @${username}`);
            }
        } else {
            // Если аккаунт уже существует: "у вас уже существует аккаунт зайдите через войти"
            errorEl.innerText = response.message || "⚠️ Произошла ошибка регистрации.";
            errorEl.style.display = 'block';
        }
    });
}

// ============ ОБРАБОТКА ВХОДА ============
function processLogin() {
    const usernameInput = document.getElementById('login-username');
    const passwordInput = document.getElementById('login-password');
    const errorEl = document.getElementById('login-error-msg');

    if (!usernameInput || !passwordInput || !errorEl) return;

    const username = usernameInput.value.trim().replace('@', '');
    const password = passwordInput.value;

    errorEl.style.display = 'none';

    if (!username || !password) {
        errorEl.innerText = "⚠️ Заполните все поля ввода!";
        errorEl.style.display = 'block';
        return;
    }

    if (!window.socket || !window.isConnected) {
        errorEl.innerText = "❌ Нет соединения с сервером!";
        errorEl.style.display = 'block';
        return;
    }

    window.socket.emit('login_user', {
        username: username,
        password: password
    }, (response) => {
        if (response && response.status === 'success') {
            const user = response.user;
            
            const sessionData = {
                id: user.telegram_id || user.id,
                username: user.username,
                first_name: user.first_name || 'User'
            };
            localStorage.setItem('dicegram_user', JSON.stringify(sessionData));
            window.MY_ID = sessionData.id;
            window.MY_USERNAME = sessionData.username;

            showAuthScreen('main');
            if (typeof initProfile === 'function') initProfile();

            if (typeof showAlert === 'function') showAlert("✅ Вход выполнен успешно!");
        } else {
            errorEl.innerText = response.message || "⚠️ Неверный юзернейм или пароль!";
            errorEl.style.display = 'block';
        }
    });
}

// Экспорт функций в глобальный объект window
window.showAuthScreen = showAuthScreen;
window.processRegister = processRegister;
window.processLogin = processLogin;

