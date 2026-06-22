// Подключение к серверу (укажи свой URL)
const socket = io("https://a38499-be46.m.jrnm.app");

const tg = window.Telegram.WebApp;
tg.expand(); // Разворачиваем на весь экран

// При загрузке страницы авторизуемся на бэкенде
document.addEventListener("DOMContentLoaded", () => {
    const userData = {
        telegram_id: tg.initDataUnsafe.user?.id || 8771009385,
        username: tg.initDataUnsafe.user?.username || "dauletbr",
        fullname: (tg.initDataUnsafe.user?.first_name || "") + " " + (tg.initDataUnsafe.user?.last_name || ""),
        avatar_url: ""
    };

    // Отправляем данные на сервер для авторизации
    socket.emit("auth", userData);
});

// Слушаем успешную авторизацию от сервера
socket.on("auth_success", (user) => {
    renderProfile(user);
});

function renderProfile(user) {
    const root = document.getElementById("profile-page");
    
    // Тот самый дизайн из image_5.png
    root.innerHTML = `
        <div class="profile-section">
            <div class="profile-main-card">
                <div class="profile-avatar-wrapper">
                    <img src="https://ui-avatars.com/api/?name=${user.fullname}" alt="Avatar">
                </div>
                <div class="profile-name-row">
                    ${user.fullname} 
                    ${user.is_verified ? '<span class="verified-icon">✔</span>' : ''}
                </div>
                <div class="profile-user-tag">@${user.username}</div>
                <div class="profile-online-status">Был(а) в сети недавно</div>
            </div>

            <div class="profile-details-container">
                <div class="profile-info-row">
                    <span class="profile-info-label">Имя</span>
                    <span class="profile-info-value">${user.fullname}</span>
                </div>
                <div class="profile-info-row">
                    <span class="profile-info-label">Username</span>
                    <span class="profile-info-value">@${user.username}</span>
                </div>
                <div class="profile-info-row">
                    <span class="profile-info-label">О себе</span>
                    <span class="profile-info-value">${user.bio || 'Нет описания'}</span>
                </div>
                <div class="profile-info-row">
                    <span class="profile-info-label">Роль</span>
                    <span class="profile-info-value">${user.role}</span>
                </div>
            </div>
        </div>
    `;
}
