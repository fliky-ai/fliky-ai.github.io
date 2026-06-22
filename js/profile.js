// ==========================================================================
// DICEGRAM - PROFILE GENERATOR
// ==========================================================================

function renderUserProfile() {
    // 1. Инициализируем или получаем данные (можешь заменить на свои переменные)
    const userData = {
        name: "owner dicegram",
        username: "@owner",
        bio: "I m owner",
        language: "Русский",
        avatarUrl: "https://p16-va.tiktokcdn.com/img/musically-maliva-obj/1651478144018438~c5_1080x1080.jpeg", // Ссылка на твой аватар со скелетом
        isVerified: true // Отображать ли галочку
    };

    // Находим корневой элемент, куда вставляется профиль (например, <div id="profile-page"></div>)
    const profileContainer = document.getElementById("profile-page");
    if (!profileContainer) return;

    // Очищаем контейнер перед рендером
    profileContainer.innerHTML = "";

    // Создаем главную секцию профиля
    const profileSection = document.createElement("div");
    profileSection.className = "profile-section";

    // 2. Рендерим верхнюю карточку (Аватар + Имя + Юзернейм + Статус)
    const mainCard = document.createElement("div");
    mainCard.className = "profile-main-card";

    // Блок аватара
    const avatarWrapper = document.createElement("div");
    avatarWrapper.className = "profile-avatar-wrapper";
    const avatarImg = document.createElement("img");
    avatarImg.src = userData.avatarUrl || "assets/default-avatar.png";
    avatarImg.alt = "User Avatar";
    avatarWrapper.appendChild(avatarImg);

    // Блок имени и галочки
    const nameRow = document.createElement("div");
    nameRow.className = "profile-name-row";
    nameRow.textContent = userData.name;

    if (userData.isVerified) {
        const verifiedBadge = document.createElement("span");
        verifiedBadge.className = "profile-verified-badge";
        // SVG иконка верифицированной галочки (синяя/зеленая как в ТГ)
        verifiedBadge.innerHTML = `
            <svg viewBox="0 0 24 24" width="18" height="18" fill="#2f8cc9">
                <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
            </svg>
        `;
        nameRow.appendChild(verifiedBadge);
    }

    // Юзернейм
    const userTag = document.createElement("div");
    userTag.className = "profile-user-tag";
    userTag.textContent = userData.username;

    // Статус сети
    const onlineStatus = document.createElement("div");
    onlineStatus.className = "profile-online-status";
    onlineStatus.textContent = "Был(а) в сети недавно";

    // Собираем карточку вместе
    mainCard.appendChild(avatarWrapper);
    mainCard.appendChild(nameRow);
    mainCard.appendChild(userTag);
    mainCard.appendChild(onlineStatus);
    profileSection.appendChild(mainCard);

    // 3. Рендерим нижний блок с плашками (Имя, Юзернейм, О себе, Язык)
    const detailsContainer = document.createElement("div");
    detailsContainer.className = "profile-details-container";

    // Данные для красивых строк
    const rowsData = [
        { label: "Имя", value: userData.name },
        { label: "Username", value: userData.username },
        { label: "О себе", value: userData.bio },
        { label: "Язык", value: userData.language }
    ];

    // Циклом создаем плашки для каждого пункта
    rowsData.forEach(item => {
        const infoRow = document.createElement("div");
        infoRow.className = "profile-info-row";

        const labelSpan = document.createElement("span");
        labelSpan.className = "profile-info-label";
        labelSpan.textContent = item.label;

        const valueSpan = document.createElement("span");
        valueSpan.className = "profile-info-value";
        valueSpan.textContent = item.value;

        infoRow.appendChild(labelSpan);
        infoRow.appendChild(valueSpan);
        detailsContainer.appendChild(infoRow);
    });

    profileSection.appendChild(detailsContainer);
    profileContainer.appendChild(profileSection);
}

// Запуск функции при загрузке страницы скрипта
document.addEventListener("DOMContentLoaded", renderUserProfile);

