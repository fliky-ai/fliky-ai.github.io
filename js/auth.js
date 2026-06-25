function showAuthScreen(screenName) {
    document.getElementById("screen-auth-choice").style.display = "none";
    document.getElementById("screen-auth-login").style.display = "none";
    document.getElementById("screen-auth-register").style.display = "none";
    
    if (screenName === 'choice') {
        document.getElementById("screen-auth-choice").style.display = "flex";
    } else if (screenName === 'login') {
        document.getElementById("screen-auth-login").style.display = "flex";
    } else if (screenName === 'register') {
        document.getElementById("screen-auth-register").style.display = "flex";
        
        // Пытаемся взять данные из Telegram Mini App SDK
        if (window.Telegram && window.Telegram.WebApp.initDataUnsafe.user) {
            tgUser = window.Telegram.WebApp.initDataUnsafe.user;
            if (tgUser.username) {
                document.getElementById("reg-username").value = tgUser.username;
            }
        }
    }
}

function processRegister() {
    const username = document.getElementById("reg-username").value.trim();
    const password = document.getElementById("reg-password").value;
    const confirmPass = document.getElementById("reg-password-confirm").value;
    const errorMsg = document.getElementById("reg-error-msg");
    
    errorMsg.style.display = "none";
    
    if (!username) {
        errorMsg.innerText = "⚠️ Напишите вашего юзернейм из оригиналного телеграмма!";
        errorMsg.style.display = "block";
        return;
    }
    if (!password) {
        errorMsg.innerText = "⚠️ Создайте пароль!";
        errorMsg.style.display = "block";
        return;
    }
    if (password !== confirmPass) {
        errorMsg.innerText = "⚠️ Пароли не совпадают!";
        errorMsg.style.display = "block";
        return;
    }
    
    // Если сидим через Mini App — берем реальный Telegram ID
    let tgId = "web_" + Math.floor(Math.random() * 1000000);
    let firstName = "Пользователь";
    
    if (window.Telegram && window.Telegram.WebApp.initDataUnsafe.user) {
        tgId = window.Telegram.WebApp.initDataUnsafe.user.id;
        firstName = window.Telegram.WebApp.initDataUnsafe.user.first_name;
    }
    
    socket.emit('register_user', {
        username: username,
        password: password,
        telegram_id: tgId,
        first_name: firstName
    }, (response) => {
        if (response.status === 'success') {
            alert("✨ Аккаунт успешно создан! Теперь войдите.");
            showAuthScreen('login');
            document.getElementById("login-username").value = username;
        } else {
            // Вернет: "у вас уже существует аккаунт зайдите через войти"
            errorMsg.innerText = response.message;
            errorMsg.style.display = "block";
        }
    });
}

function processLogin() {
    const username = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value;
    const errorMsg = document.getElementById("login-error-msg");
    
    errorMsg.style.display = "none";
    
    if (!username || !password) {
        errorMsg.innerText = "⚠️ Заполните все поля ввода!";
        errorMsg.style.display = "block";
        return;
    }
    
    socket.emit('login_user', { username: username, password: password }, (response) => {
        if (response.status === 'success') {
            // Присваиваем данные в твои глобальные переменные из config.js
            MY_ID = response.user.telegram_id;
            MY_USERNAME = response.user.username;
            
            document.getElementById("screen-auth-login").style.display = "none";
            document.getElementById("app-container").style.display = "flex";
            
            // Запускаем ленту роликов
            loadVideoFeed();
        } else {
            errorMsg.innerText = response.message;
            errorMsg.style.display = "block";
        }
    });
}
