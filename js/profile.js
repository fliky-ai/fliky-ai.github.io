here// ============ ПРОФИЛЬ ============
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
                
                document.getElementById('user-name').innerText = displayName;
                document.getElementById('user-username').innerText = MY_USERNAME ? `@${MY_USERNAME}` : '';
                document.getElementById('profile-username-display').innerText = MY_USERNAME ? `@${MY_USERNAME}` : '';
                document.getElementById('profile-display-name').innerText = displayName;
                
                if (currentUserData.photo_url) {
                    document.getElementById('user-avatar').src = currentUserData.photo_url;
                }
                if (currentUserData.bio) {
                    document.getElementById('profile-bio-display').innerText = currentUserData.bio;
                }
                
                // Показываем верификацию в профиле как в Telegram
                if (currentUserData.is_verified) {
                    const nameEl = document.getElementById('user-name');
                    if (!nameEl.innerHTML.includes('✅')) {
                        nameEl.innerHTML = displayName + ' ✅';
                    }
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
            avatarEl.innerText = (user.first_name || 'U').substring(0, 2).toUpperCase();
            
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
                    <div style="background:rgba(47, 140, 201, 0.1);padding:12px 16px;border-radius:12px;margin-top:8px;border:1px solid rgba(47, 140, 201, 0.2);">
                        <div style="display:flex;align-items:center;gap:8px;font-size:14px;color:var(--tg-verified);">
                            <span style="font-size:18px;">✅</span>
                            <span>This account is verified as official by the representatives of Dicegram</span>
                        </div>
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
                    <button onclick="toggleVerification('${userId}', ${!user.is_verified})" 
                            style="background:var(--tg-verified);color:white;border:none;padding:14px 20px;border-radius:12px;font-size:16px;cursor:pointer;width:100%;">
                        ${verifyBtnText}
                    </button>
                    <button onclick="addContact()" 
                            style="background:var(--tg-accent-color);color:white;border:none;padding:14px 20px;border-radius:12px;font-size:16px;cursor:pointer;width:100%;">
                        ➕ Добавить в контакты
                    </button>
                    <button onclick="blockUser()" 
                            style="background:#ff3b30;color:white;border:none;padding:14px 20px;border-radius:12px;font-size:16px;cursor:pointer;width:100%;">
                        🚫 Заблокировать
                    </button>
                `;
            } else {
                actionsDiv.innerHTML = `
                    <button onclick="addContact()" 
                            style="background:var(--tg-accent-color);color:white;border:none;padding:14px 20px;border-radius:12px;font-size:16px;cursor:pointer;width:100%;">
                        ➕ Добавить в контакты
                    </button>
                    <button onclick="blockUser()" 
                            style="background:#ff3b30;color:white;border:none;padding:14px 20px;border-radius:12px;font-size:16px;cursor:pointer;width:100%;">
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
    const newName = prompt('Введите новое имя:', tgUser.first_name || '');
    if (newName && newName.trim()) {
        socket.emit('update_profile', { name: newName.trim() }, (response) => {
            if (response && response.status === 'ok') {
                document.getElementById('user-name').innerText = newName.trim();
                document.getElementById('profile-display-name').innerText = newName.trim();
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
    const newUsername = prompt('Введите новый username:', MY_USERNAME || '');
    
    if (newUsername && newUsername.trim()) {
        const username = newUsername.trim().replace('@', '');
        
        socket.emit('check_username', { username: username }, (response) => {
            if (response && response.status === 'taken' && !isCreator) {
                alert('❌ Этот username уже занят');
                return;
            }
            
            socket.emit('update_profile', { username: username }, (response) => {
                if (response && response.status === 'ok') {
                    MY_USERNAME = username;
                    initProfile();
                    alert('✅ Username обновлен!');
                    socket.emit('get_user_info', { user_id: MY_ID }, (userInfo) => {
                        if (userInfo && userInfo.status === 'found') {
                            currentUserData = userInfo.user;
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
    const newBio = prompt('Введите описание (О себе):', currentUserData?.bio || '');
    if (newBio !== null) {
        socket.emit('update_profile', { bio: newBio.trim() }, (response) => {
            if (response && response.status === 'ok') {
                document.getElementById('profile-bio-display').innerText = newBio.trim() || 'Добавить описание';
                alert('✅ О себе обновлено!');
                if (currentUserData) currentUserData.bio = newBio.trim();
                socket.emit('get_user_info', { user_id: MY_ID }, (userInfo) => {
                    if (userInfo && userInfo.status === 'found') {
                        currentUserData = userInfo.user;
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
        socket.emit('update_profile', { photo_url: url.trim() });
    }
}

function changeLanguage() {
    alert('🌐 Выбор языка будет доступен в следующей версии');
            }
