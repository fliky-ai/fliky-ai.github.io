// ============ ПРОФИЛЬ ============
let currentUserData = null;

function initProfile() {
    const fullName = `${tgUser.first_name} ${tgUser.last_name || ''}`.trim();
    document.getElementById('user-name').innerText = fullName || 'Пользователь';
    document.getElementById('user-username').innerText = MY_USERNAME ? `@${MY_USERNAME}` : '';
    document.getElementById('profile-username-display').innerText = MY_USERNAME ? `@${MY_USERNAME}` : '';
    document.getElementById('profile-display-name').innerText = fullName || 'Изменить';
    if (tgUser.photo_url) {
        document.getElementById('user-avatar').src = tgUser.photo_url;
    }
    if (currentUserData && currentUserData.bio) {
        document.getElementById('profile-bio-display').innerText = currentUserData.bio;
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
            document.getElementById('popup-user-name').innerText = user.first_name || 'Пользователь';
            document.getElementById('popup-avatar').innerText = (user.first_name || 'U').substring(0, 2).toUpperCase();
            document.getElementById('popup-name').innerText = user.first_name || 'Пользователь';
            document.getElementById('popup-username').innerText = `@${user.username || ''}`;
            document.getElementById('popup-bio').innerText = user.bio || 'Нет описания';
            document.getElementById('popup-status').innerText = user.is_online ? '🟢 В сети' : '⚪ Был(а) недавно';
            
            const isVerified = userId === CONFIG.CREATOR_ID || user.is_verified;
            document.getElementById('popup-verified').innerHTML = isVerified ? '✅ Верифицирован' : '';
            
            const createdDate = user.created_at ? new Date(user.created_at).toLocaleDateString() : 'Неизвестно';
            document.getElementById('popup-created').innerText = `📅 Зарегистрирован: ${createdDate}`;
            
            const actionsDiv = document.getElementById('popup-actions');
            if (MY_ID === CONFIG.CREATOR_ID && userId !== CONFIG.CREATOR_ID) {
                const verifyBtnText = user.is_verified ? '❌ Снять верификацию' : '✅ Выдать верификацию';
                actionsDiv.innerHTML = `
                    <button onclick="toggleVerification('${userId}', ${!user.is_verified})" style="background:var(--tg-verified);color:white;border:none;padding:12px;border-radius:12px;font-size:16px;cursor:pointer;">${verifyBtnText}</button>
                    <button onclick="addContact()" style="background:var(--tg-accent-color);color:white;border:none;padding:12px;border-radius:12px;font-size:16px;cursor:pointer;">➕ Добавить в контакты</button>
                    <button onclick="blockUser()" style="background:#ff3b30;color:white;border:none;padding:12px;border-radius:12px;font-size:16px;cursor:pointer;">🚫 Заблокировать</button>
                `;
            } else {
                actionsDiv.innerHTML = `
                    <button onclick="addContact()" style="background:var(--tg-accent-color);color:white;border:none;padding:12px;border-radius:12px;font-size:16px;cursor:pointer;">➕ Добавить в контакты</button>
                    <button onclick="blockUser()" style="background:#ff3b30;color:white;border:none;padding:12px;border-radius:12px;font-size:16px;cursor:pointer;">🚫 Заблокировать</button>
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
    const newBio = prompt('Введите описание (Bio):', currentUserData?.bio || '');
    if (newBio !== null) {
        socket.emit('update_profile', { bio: newBio.trim() }, (response) => {
            if (response && response.status === 'ok') {
                document.getElementById('profile-bio-display').innerText = newBio.trim() || 'Добавить описание';
                alert('✅ Bio обновлен!');
                if (currentUserData) currentUserData.bio = newBio.trim();
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