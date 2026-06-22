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
                if (currentUserData.last_name) {
                    document.getElementById('user-name').innerText = `${fullName} ${currentUserData.last_name}`;
                } else {
                    document.getElementById('user-name').innerText = fullName;
                }
                document.getElementById('user-username').innerText = MY_USERNAME ? `@${MY_USERNAME}` : '';
                document.getElementById('profile-username-display').innerText = MY_USERNAME ? `@${MY_USERNAME}` : '';
                document.getElementById('profile-display-name').innerText = document.getElementById('user-name').innerText;
                
                if (currentUserData.photo_url) {
                    document.getElementById('user-avatar').src = currentUserData.photo_url;
                }
                if (currentUserData.bio) {
                    document.getElementById('profile-bio-display').innerText = currentUserData.bio;
                }
                
                // Показываем верификацию в профиле
                if (currentUserData.is_verified) {
                    document.getElementById('user-name').innerHTML = document.getElementById('user-name').innerText + ' ✅';
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
            document.getElementById('popup-user-name').innerText = fullName + (user.last_name ? ' ' + user.last_name : '');
            document.getElementById('popup-avatar').innerText = (user.first_name || 'U').substring(0, 2).toUpperCase();
            document.getElementById('popup-name').innerText = fullName + (user.last_name ? ' ' + user.last_name : '');
            document.getElementById('popup-username').innerText = `@${user.username || ''}`;
            document.getElementById('popup-bio').innerText = user.bio || 'Нет описания';
            document.getElementById('popup-status').innerText = user.is_online ? '🟢 В сети' : '⚪ Был(а) недавно';
            
            const isVerified = userId === CONFIG.CREATOR_ID || userId === '0' || user.is_verified;
            if (isVerified) {
                document.getElementById('popup-verified').innerHTML = '✅ Верифицирован\n\nThis account is verified as official by the representatives of Dicegram';
                document.getElementById('popup-name').innerHTML = (fullName + (user.last_name ? ' ' + user.last_name : '')) + ' ✅';
            } else {
                document.getElementById('popup-verified').innerHTML = '';
            }
            
            const createdDate = user.created_at ? new Date(user.created_at).toLocaleDateString() : 'Неизвестно';
            document.getElementById('popup-created').innerText = `📅 Зарегистрирован: ${createdDate}`;
            
            const actionsDiv = document.getElementById('popup-actions');
            if (MY_ID === CONFIG.CREATOR_ID && userId !== CONFIG.CREATOR_ID && userId !== '0') {
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
                // Обновляем данные пользователя
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
                // Сохраняем в базу
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
