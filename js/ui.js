function changeTab(tabName) {
    const feedContainer = document.getElementById("video-feed");
    const navItems = document.querySelectorAll(".nav-item");
    
    // Снимаем активный класс со всех кнопок меню
    navItems.forEach(item => item.classList.remove("active"));

    if (tabName === 'feed') {
        navItems[0].classList.add("active");
        // Перезагружаем и показываем ленту видео
        loadVideoFeed();
    } else if (tabName === 'profile') {
        navItems[1].classList.add("active");
        
        // Ставим на паузу все видео в ленте, чтобы звук не мешал в профиле
        document.querySelectorAll("video").forEach(v => v.pause());
        
        // Рендерим темный минималистичный профиль тиктокера
        feedContainer.innerHTML = `
            <div class="profile-container" style="padding: 40px 20px; text-align: center; background-color: #000;">
                <div class="profile-avatar" style="width: 90px; height: 90px; background: #222; border-radius: 50%; margin: 0 auto 15px; display: flex; align-items: center; justify-content: center; font-size: 32px; border: 2px solid #fe2c55;">👤</div>
                <h2 style="font-size: 22px; font-weight: bold; margin-bottom: 5px;">@${MY_USERNAME}</h2>
                <p style="color: #8a8a8a; font-size: 14px; margin-bottom: 20px;">ID: ${MY_ID}</p>
                
                <div class="profile-stats" style="display: flex; justify-content: center; gap: 30px; margin-bottom: 30px; border-top: 1px solid #111; border-bottom: 1px solid #111; padding: 15px 0;">
                    <div><strong>0</strong> <span style="color:#777; display:block; font-size:12px;">Видео</span></div>
                    <div><strong>0</strong> <span style="color:#777; display:block; font-size:12px;">Подписчики</span></div>
                    <div><strong>0</strong> <span style="color:#777; display:block; font-size:12px;">Лайки</span></div>
                </div>

                <button class="btn" style="background-color: #121212; color: #ff4545; border: 1px solid #222; max-width: 200px; margin: 0 auto;" onclick="logout()">Выйти из системы</button>
            </div>
        `;
    }
}

function logout() {
    if (confirm("Вы уверены, что хотите выйти?")) {
        // Сбрасываем глобальное состояние
        MY_ID = null;
        MY_USERNAME = '';
        
        // Возвращаем на начальный экран выбора авторизации
        document.getElementById("app-container").style.display = "none";
        showAuthScreen('choice');
    }
}

