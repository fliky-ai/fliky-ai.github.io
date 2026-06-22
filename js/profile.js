// ============ ПРОФИЛЬ ============
let currentUserData = null;

function initProfile() {
    // Загружаем данные пользователя с сервера
    if (socket && isConnected) {
        socket.emit('get_user_info', { user_id: MY_ID }, (userInfo) => {
            if (userInfo && userInfo.status === 'found') {
                currentUserData = userInfo.user;
                MY_USERNAME = currentUserData.username || MY_USERNAME;
                
                const fullName = currentUserData.first_name || tgUser.first_name || 'Пользователь';
                const displayName = currentUserData.last_name ? `${fullName} ${currentUserData.last_name}` : fullName;
                
                // Обновляем имя
                const nameEl = document.getElementById('user-name');
                if (currentUserData.is_verified) {
                    nameEl.innerHTML = displayName + ' ✅';
                } else {
                    nameEl.innerText = displayName;
                }
                
                // Обновляем username
                document.getElementById('user-username').innerText = MY_USERNAME ? `@${MY_USERNAME}` : '';
                document.getElementById('profile-username-display').innerText = MY_USERNAME ? `@${MY_USERNAME}` : '';
                document.getElementById('profile-display-name').innerText = displayName;
                
                // Обновляем аватар
                if (currentUserData.photo_url && currentUserData.photo_url.startsWith('http')) {
                    document.getElementById('user-avatar').src = currentUserData.photo_url;
                } else {
                    // Если нет фото, показываем инициалы
                    const avatarEl = document.getElementById('user-avatar');
                    const initials = displayName.substring(0, 2).toUpperCase();
                    avatarEl.style.background = 'linear-gradient(135deg, #5085b1, #366187)';
                    avatarEl.style.display = 'flex';
                    avatarEl.style.alignItems = 'center';
                    avatarEl.style.justifyContent = 'center';
                    avatarEl.style.color = '#fff';
                    avatarEl.style.fontSize = '32px';
                    avatarEl.style.fontWeight = '600';
                    avatarEl.src = '';
                    avatarEl.alt = initials;
                    // Создаем canvas для аватарки
                    const canvas = document.createElement('canvas');
                    canvas.width = 100;
                    canvas.height = 100;
                    const ctx = canvas.getContext('2d');
                    const gradient = ctx.createLinearGradient(0, 0, 100, 100);
                    gradient.addColorStop(0, '#5085b1');
                    gradient.addColorStop(1, '#366187');
                    ctx.fillStyle = gradient;
                    ctx.beginPath();
                    ctx.arc(50, 50, 50, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = '#fff';
                    ctx.font = 'bold 40px Arial';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(initials, 50, 52);
                    avatarEl.src = canvas.toDataURL();
                }
                
                // Обновляем bio
                if (currentUserData.bio) {
                    document.getElementById('profile-bio-display').innerText = currentUserData.bio;
                } else {
                    document.getElementById('profile-bio-display').innerText = 'Добавить описание';
                }
            }
        });
    }
}

function showUserProfile(userId) {
    if (!userId) return;
    
    if (!socket || !isConnected) {
        alert('Нет соединения с сервером');
        return;
    }

    socket.emit('get_user_info', { user_id: userId }, (userInfo) => {
        if (userInfo && userInfo.status === 'found') {
            const user = userInfo.user;
            window.currentUserData = user;
            
            const popup = document.getElementById('profile-popup');
            const fullName = user.first_name || 'Пользователь';
            const displayName = user.last_name ? `${fullName} ${user.last_name}` : fullName;
            
            // Заголовок
            document.getElementById('popup-user-name').innerText = displayName;
            
            // Аватар
            const avatarEl = document.getElementById('popup-avatar');
            if (user.photo_url && user.photo_url.startsWith('http')) {
                avatarEl.style.backgroundImage = `url(${user.photo_url})`;
                avatarEl.style.backgroundSize = 'cover';
                avatarEl.style.backgroundPosition = 'center';
                avatarEl.innerText = '';
            } else {
                avatarEl.style.background = 'linear-gradient(135deg, #5085b1, #366187)';
                avatarEl.style.backgroundSize = 'cover';
                avatarEl.innerText = (user.first_name || 'U').substring(0, 2).toUpperCase();
            }
            
            // Имя с галочкой как в Telegram
            const nameEl = document.getElementById('popup-name');
            const isVerified = userId === CONFIG.CREATOR_ID || userId === CONFIG.SUPPORT_ID || user.is_verified;
            if (isVerified) {
                nameEl.innerHTML = `${displayName} <span style="color:var(--tg-verified);font-size:18px;">✅</span>`;
            } else {
                nameEl.innerText = displayName;
            }
            
            // Username
            document.getElementById('popup-username').innerText = user.username ? `@${user.username}` : '';
            
            // Статус (как в Telegram)
            const statusEl = document.getElementById('popup-status');
            if (user.is_online) {
                statusEl.innerText = '🟢 В сети';
                statusEl.style.color = 'var(--tg-status-online)';
            } else {
                const lastSeen = user.last_seen ? new Date(user.last_seen) : new Date();
                const now = new Date();
                const diff = Math.floor((now - lastSeen) / 1000);
                
                if (diff < 60) {
                    statusEl.innerText = '⚪ Был(а) только что';
                } else if (diff < 3600) {
                    const minutes = Math.floor(diff / 60);
                    statusEl.innerText = `⚪ Был(а) ${minutes} мин. назад`;
                } else if (diff < 86400) {
                    const hours = Math.floor(diff / 3600);
                    statusEl.innerText = `⚪ Был(а) ${hours} ч. назад`;
                } else {
                    const days = Math.floor(diff / 86400);
                    statusEl.innerText = `⚪ Был(а) ${days} дн. назад`;
                }
                statusEl.style.color = 'var(--tg-text-secondary)';
            }
            
            // Bio
            document.getElementById('popup-bio').innerText = user.bio || 'Нет описания';
            
            // Дата регистрации как в Telegram
            const createdDate = user.created_at ? new Date(user.created_at).toLocaleDateString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            }) : 'Неизвестно';
            document.getElementById('popup-created').innerText = `📅 Зарегистрирован: ${createdDate}`;
            
            // Верификация (официальная надпись)
            const verifiedEl = document.getElementById('popup-verified');
            if (isVerified) {
                verifiedEl.innerHTML = `
                    <div class="verified-box">
                        <span class="icon">✅</span>
                        <span>This account is verified as official by the representatives of Dicegram</span>
                    </div>
                `;
            } else {
                verifiedEl.innerHTML = '';
            }
            
            // Кнопки действий
            const actionsDiv = document.getElementById('popup-actions');
            if (MY_ID === CONFIG.CREATOR_ID && userId !== CONFIG.CREATOR_ID && userId !== CONFIG.SUPPORT_ID) {
                const verifyBtnText = user.is_verified ? '❌ Снять верификацию' : '✅ Выдать верификацию';
                actionsDiv.innerHTML = `
                    <button class="btn-verify" onclick="toggleVerification('${userId}', ${!user.is_verified})">
                        ${verifyBtnText}
                    </button>
                    <button class="btn-contact" onclick="addContact()">
                        ➕ Добавить в контакты
                    </button>
                    <button class="btn-block" onclick="blockUser()">
                        🚫 Заблокировать
                    </button>
                `;
            } else {
                actionsDiv.innerHTML = `
                    <button class="btn-contact" onclick="addContact()">
                        ➕ Добавить в контакты
                    </button>
                    <button class="btn-block" onclick="blockUser()">
                        🚫 Заблокировать
                    </button>
                `;
            }
            
            popup.classList.add('active');
        }
    });
}

function closeProfilePopup() {
    document.getElementById('profile-popup').classList.remove('active');
}

function toggleVerification(userId, verify) {
    if (MY_ID !== CONFIG.CREATOR_ID) {
        alert('❌ Только создатель может управлять верификацией!');
        return;
    }
    socket.emit('verify_user', { user_id: userId, verify: verify }, (response) => {
        if (response && response.status === 'ok') {
            alert(verify ? '✅ Пользователь верифицирован!' : '❌ Верификация снята');
            closeProfilePopup();
            loadChatsAndMessages();
            initProfile();
        }
    });
}

function addContact() {
    if (!currentUserData) return;
    socket.emit('add_contact', { contact_id: currentUserData.telegram_id }, (response) => {
        if (response && response.status === 'ok') {
            alert('➕ Пользователь добавлен в контакты');
            loadContacts();
        }
    });
}

function blockUser() {
    if (confirm('🚫 Заблокировать пользователя?')) {
        socket.emit('block_user', { block_id: currentUserData.telegram_id }, (response) => {
            if (response && response.status === 'ok') {
                alert('Пользователь заблокирован');
                closeProfilePopup();
            }
        });
    }
}

function editName() {
    const currentName = document.getElementById('user-name').innerText.replace(' ✅', '');
    const newName = prompt('Введите новое имя:', currentName || tgUser.first_name || '');
    if (newName && newName.trim()) {
        socket.emit('update_profile', { name: newName.trim() }, (response) => {
            if (response && response.status === 'ok') {
                // Обновляем локально
                const nameEl = document.getElementById('user-name');
                if (currentUserData && currentUserData.is_verified) {
                    nameEl.innerHTML = newName.trim() + ' ✅';
                } else {
                    nameEl.innerText = newName.trim();
                }
                document.getElementById('profile-display-name').innerText = newName.trim();
                
                // Обновляем данные с сервера
                socket.emit('get_user_info', { user_id: MY_ID }, (userInfo) => {
                    if (userInfo && userInfo.status === 'found') {
                        currentUserData = userInfo.user;
                        if (currentUserData.is_verified) {
                            document.getElementById('user-name').innerHTML = newName.trim() + ' ✅';
                        }
                    }
                });
                alert('✅ Имя обновлено!');
            }
        });
    }
}

function editUsername() {
    const isCreator = MY_ID === CONFIG.CREATOR_ID;
    const currentUsername = MY_USERNAME || '';
    const newUsername = prompt('Введите новый username:', currentUsername);
    
    if (newUsername && newUsername.trim()) {
        const username = newUsername.trim().replace('@', '');
        
        // Проверяем занятость
        socket.emit('check_username', { username: username }, (response) => {
            if (response && response.status === 'taken' && !isCreator) {
                alert('❌ Этот username уже занят');
                return;
            }
            
            socket.emit('update_profile', { username: username }, (response) => {
                if (response && response.status === 'ok') {
                    MY_USERNAME = username;
                    // Обновляем UI
                    document.getElementById('user-username').innerText = `@${username}`;
                    document.getElementById('profile-username-display').innerText = `@${username}`;
                    alert('✅ Username обновлен!');
                    
                    // Обновляем данные с сервера
                    socket.emit('get_user_info', { user_id: MY_ID }, (userInfo) => {
                        if (userInfo && userInfo.status === 'found') {
                            currentUserData = userInfo.user;
                            MY_USERNAME = currentUserData.username || MY_USERNAME;
                            document.getElementById('user-username').innerText = MY_USERNAME ? `@${MY_USERNAME}` : '';
                            document.getElementById('profile-username-display').innerText = MY_USERNAME ? `@${MY_USERNAME}` : '';
                        }
                    });
                } else if (response && response.message) {
                    alert('❌ ' + response.message);
                }
            });
        });
    }
}

function editBio() {
    const currentBio = currentUserData?.bio || '';
    const newBio = prompt('Введите описание (О себе):', currentBio);
    if (newBio !== null) {
        socket.emit('update_profile', { bio: newBio.trim() }, (response) => {
            if (response && response.status === 'ok') {
                const bioEl = document.getElementById('profile-bio-display');
                bioEl.innerText = newBio.trim() || 'Добавить описание';
                alert('✅ О себе обновлено!');
                
                // Обновляем данные с сервера
                socket.emit('get_user_info', { user_id: MY_ID }, (userInfo) => {
                    if (userInfo && userInfo.status === 'found') {
                        currentUserData = userInfo.user;
                        if (currentUserData.bio) {
                            document.getElementById('profile-bio-display').innerText = currentUserData.bio;
                        }
                    }
                });
            }
        });
    }
}

function changeAvatar() {
    const url = prompt('Введите URL фото профиля:');
    if (url && url.trim()) {
        document.getElementById('user-avatar').src = url.trim();
        socket.emit('update_profile', { photo_url: url.trim() }, (response) => {
            if (response && response.status === 'ok') {
                alert('✅ Аватар обновлен!');
                socket.emit('get_user_info', { user_id: MY_ID }, (userInfo) => {
                    if (userInfo && userInfo.status === 'found') {
                        currentUserData = userInfo.user;
                        initProfile();
                    }
                });
            }
        });
    }
}

function changeLanguage() {
    alert('🌐 Выбор языка будет доступен в следующей версии');
}

// Инициализация профиля при загрузке
setTimeout(initProfile, 1000);
