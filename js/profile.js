// ==========================================================================
// DICEGRAM - PROFILE POPUP ENGINE
// ==========================================================================

// Инициализация структуры модального окна в DOM
function initProfileModal() {
    if (document.getElementById("profile-modal-root")) return;

    const modal = document.createElement("div");
    modal.id = "profile-modal-root";
    modal.className = "profile-modal";

    modal.innerHTML = `
        <div class="profile-modal-header">
            <button class="profile-back-btn" id="close-profile-modal">✕</button>
            <h2 class="profile-modal-title">Профиль</h2>
            <div style="font-size: 20px; cursor: pointer;">🌙</div>
        </div>
        <div class="profile-main-card">
            <div class="profile-avatar-wrapper">
                <img id="p-modal-avatar" src="" alt="Avatar">
            </div>
            <div class="profile-name-row">
                <span id="p-modal-name"></span>
                <span id="p-modal-verified" style="display:none;">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="#2f8cc9" style="vertical-align: middle;">
                        <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                    </svg>
                </span>
            </div>
            <div class="profile-user-tag" id="p-modal-username"></div>
            <div class="profile-online-status" id="p-modal-status">Был(а) в сети недавно</div>
        </div>
        <div class="profile-details-container">
            <div class="profile-info-row">
                <span class="profile-info-label">Имя</span>
                <span class="profile-info-value" id="p-row-name"></span>
            </div>
            <div class="profile-info-row">
                <span class="profile-info-label">Username</span>
                <span class="profile-info-value" id="p-row-username"></span>
            </div>
            <div class="profile-info-row">
                <span class="profile-info-label">О себе</span>
                <span class="profile-info-value" id="p-row-bio"></span>
            </div>
            <div class="profile-info-row">
                <span class="profile-info-label">Язык</span>
                <span class="profile-info-value" id="p-row-lang"></span>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Вешаем событие закрытия на крестик
    document.getElementById("close-profile-modal").addEventListener("click", () => {
        modal.classList.remove("active");
    });
}

/**
 * Глобальная функция для открытия профиля любого пользователя
 * @param {Object} user - Объект с данными пользователя
 */
function openUserProfile(user) {
    // Проверяем, создана ли разметка модалки
    initProfileModal();

    const modal = document.getElementById("profile-modal-root");

    // Подставляем динамические данные в макет из image_9.png
    document.getElementById("p-modal-avatar").src = user.avatarUrl || "https://p16-va.tiktokcdn.com/img/musically-maliva-obj/1651478144018438~c5_1080x1080.jpeg";
    document.getElementById("p-modal-name").textContent = user.name || "owner dicegram";
    document.getElementById("p-modal-username").textContent = user.username || "@owner";
    document.getElementById("p-modal-status").textContent = user.status || "Был(а) в сети недавно";

    // Строки данных
    document.getElementById("p-row-name").textContent = user.name || "owner dicegram";
    document.getElementById("p-row-username").textContent = user.username || "@owner";
    document.getElementById("p-row-bio").textContent = user.bio || "I m owner";
    document.getElementById("p-row-lang").textContent = user.language || "Русский";

    // Управляем галочкой верификации
    const verifiedBadge = document.getElementById("p-modal-verified");
    if (user.isVerified) {
        verifiedBadge.style.display = "inline-flex";
    } else {
        verifiedBadge.style.display = "none";
    }

    // Открываем модалку (показываем её)
    modal.classList.add("active");
}

// Инициализируем при загрузке документа
document.addEventListener("DOMContentLoaded", initProfileModal);

