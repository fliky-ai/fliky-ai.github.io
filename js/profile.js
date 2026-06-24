// ============ ПРОФИЛЬ ============
let currentUserData = null;

function initProfile() {
    console.log('📝 initProfile() вызван');
    
    // Если нет MY_ID, пробуем взять из localStorage
    if (!MY_ID) {
        const savedUser = localStorage.getItem('dicegram_user');
        if (savedUser) {
            try {
                const user = JSON.parse(savedUser);
                if (user && user.id) {
                    MY_ID = user.id;
                    MY_USERNAME = user.username || '';
                    window.tgUser = {
                        id: user.id,
                        first_name: user.first_name || 'User',
                        username: user.username || '',
                        photo_url: user.photo_url || ''
                    };
                    console.log('👤 Восстановлен MY_ID из localStorage:', MY_ID);
                }
            } catch (e) {
                localStorage.removeItem('dicegram_user');
            }
        }
    }

    if (!MY_ID) {
        console.log('⏳ MY_ID ещё не установлен, повтор через 500мс');
        setTimeout(initProfile, 500);
        return;
    }

    if (!socket || !isConnected) {
        console.log('⏳ Сокет ещё не готов, повтор через 500мс');
        setTimeout(initProfile, 500);
        return;
    }

    console.log('📥 Загрузка профиля для:', MY_ID);
    
    socket.emit('get_user_info', { user_id: MY_ID }, (userInfo) => {
        console.log('📨 Ответ get_user_info:', userInfo);
        
        if (userInfo && userInfo.status === 'found') {
            currentUserData = userInfo.user;
            MY_USERNAME = currentUserData.username || MY_USERNAME;
            
            const fullName = currentUserData.first_name || tgUser?.first_name || 'Пользователь';
            const displayName = currentUserData.last_name ? `${fullName} ${currentUserData.last_name}` : fullName;
            
            // Обновляем имя в профиле
            const nameEl = document.getElementById('user-name');
            if (currentUserData.is_verified) {
                nameEl.innerHTML = `${displayName} <span class="verified-check"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#2f8cc9"/><path d="M9 12l2 2 4-4" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></span>`;
            } else {
                nameEl.innerText = displayName;
            }
            
            // Обновляем username
            const usernameDisplay = currentUserData.username || MY_USERNAME || '';
            document.getElementById('user-username').innerText = usernameDisplay ? `@${usernameDisplay}` : '';
            document.getElementById('profile-username-display').innerText = usernameDisplay ? `@${usernameDisplay}` : '';
            document.getElementById('profile-display-name').innerText = displayName;
            
            // Обновляем аватар
            updateAvatar('user-avatar', displayName, currentUserData.photo_url);
            
            // Обновляем bio
            if (currentUserData.bio) {
                document.getElementById('profile-bio-display').innerText = currentUserData.bio;
            } else {
                document.getElementById('profile-bio-display').innerText = 'Добавить описание';
            }
            
            console.log('✅ Профиль обновлён:', displayName, '@' + usernameDisplay);
        } else {
            console.log('⚠️ Пользователь не найден, пробуем создать через auto_auth');
            setTimeout(initProfile, 1000);
        }
    });
}

function updateAvatar(elementId, name, photoUrl) {
    const avatarEl = document.getElementById(elementId);
    const initials = name ? name.substring(0, 2).toUpperCase() : 'U';
    
    if (photoUrl && photoUrl.startsWith('http')) {
        avatarEl.src = photoUrl;
        avatarEl.style.display = 'block';
        avatarEl.style.background = 'none';
    } else {
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
        avatarEl.style.display = 'block';
        avatarEl.style.background = 'none';
    }
}

// ============ ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ ============
function showUserProfile(userId) {
    if (!userId) return;
    
    if (dynamicChats[userId] && (dynamicChats[userId].chat_type === 'group' || dynamicChats[userId].chat_type === 'channel')) {
        if (window.showGroupInfo) {
            window.showGroupInfo(userId);
        }
        return;
    }
    
    if (!socket || !isConnected) {
        showAlert('Нет соединения с сервером');
        return;
    }

    socket.emit('get_user_info', { user_id: userId }, (userInfo) => {
        if (userInfo && userInfo.status === 'found') {
            const user = userInfo.user;
            window.currentUserData = user;
            
            const popup = document.getElementById('profile-popup');
            const fullName = user.first_name || 'Пользователь';
            const displayName = user.last_name ? `${fullName} ${user.last_name}` : fullName;
            const isBot = user.is_bot === 1 || userId === CONFIG.BOTFATHER_ID;
            
            document.getElementById('popup-user-name').innerText = displayName;
            
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
            
            const nameEl = document.getElementById('popup-name');
            const isVerified = userId === CONFIG.CREATOR_ID || userId === CONFIG.SUPPORT_ID || user.is_verified;
            if (isVerified) {
                nameEl.innerHTML = `${displayName} <span class="verified-check"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#2f8cc9"/><path d="M9 12l2 2 4-4" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></span>`;
            } else {
                nameEl.innerText = displayName;
            }
            
            document.getElementById('popup-username').innerText = user.username ? `@${user.username}` : '';
            
            const statusEl = document.getElementById('popup-status');
            if (isBot) {
                statusEl.innerText = '🤖 Бот';
                statusEl.style.color = 'var(--tg-text-secondary)';
            } else if (user.is_online) {
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
            
            document.getElementById('popup-bio').innerText = user.bio || (isBot ? 'Бот создан в DICEGRAM' : 'Нет описания');
            document.getElementById('popup-bio').style.display = 'block';
            
            const createdDate = user.created_at ? new Date(user.created_at).toLocaleDateString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            }) : 'Неизвестно';
            document.getElementById('popup-created').innerText = `📅 Зарегистрирован: ${createdDate}`;
            document.getElementById('popup-created').style.display = 'block';
            
            const verifiedEl = document.getElementById('popup-verified');
            if (isVerified) {
                verifiedEl.innerHTML = `
                    <div class="verified-box">
                        <span class="icon"><svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#2f8cc9"/><path d="M9 12l2 2 4-4" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></span>
                        <span>This account is verified as official by the representatives of Dicegram</span>
                    </div>
                `;
            } else {
                verifiedEl.innerHTML = '';
            }
            
            const actionsDiv = document.getElementById('popup-actions');
            actionsDiv.innerHTML = '';
            
            const chatBtn = document.createElement('button');
            chatBtn.className = 'btn-chat';
            chatBtn.innerText = '💬 Написать';
            chatBtn.onclick = () => {
                if (!dynamicChats[userId]) {
                    dynamicChats[userId] = {
                        first_name: displayName,
                        username: user.username || ''
                    };
                    createChatRow(userId, displayName, user.username || '', isVerified);
                }
                openChat(userId);
                closeProfilePopup();
            };
            actionsDiv.appendChild(chatBtn);
            
            const shareBtn = document.createElement('button');
            shareBtn.className = 'btn-share';
            shareBtn.innerText = '🔗 Поделиться ссылкой';
            shareBtn.onclick = () => {
                const shareUrl = `https://t.me/${user.username || userId}`;
                if (navigator.share) {
                    navigator.share({
                        title: displayName,
                        url: shareUrl
                    }).catch(() => {});
                } else {
                    navigator.clipboard.writeText(shareUrl).then(() => {
                        showAlert('🔗 Ссылка скопирована!');
                    });
                }
            };
            actionsDiv.appendChild(shareBtn);
            
            if (MY_ID === CONFIG.CREATOR_ID && userId !== CONFIG.CREATOR_ID && userId !== CONFIG.SUPPORT_ID) {
                const verifyBtnText = user.is_verified ? '❌ Снять верификацию' : '✅ Выдать верификацию';
                const verifyBtn = document.createElement('button');
                verifyBtn.className = 'btn-verify';
                verifyBtn.innerText = verifyBtnText;
                verifyBtn.onclick = () => toggleVerification(userId, !user.is_verified);
                actionsDiv.appendChild(verifyBtn);
            }
            
            if (userId !== MY_ID && userId !== CONFIG.SUPPORT_ID) {
                const blockBtn = document.createElement('button');
                blockBtn.className = 'btn-block';
                blockBtn.innerText = '🚫 Заблокировать';
                blockBtn.onclick = blockUser;
                actionsDiv.appendChild(blockBtn);
            }
            
            popup.classList.add('active');
        }
    });
}

// ============ ИНФОРМАЦИЯ О ГРУППЕ ============
function showGroupInfo(chatId) {
    if (!chatId) return;
    
    socket.emit('get_group_info', { chat_id: chatId }, (info) => {
        if (info && info.status === 'found') {
            const chat = info.chat;
            socket.emit('get_group_members', { chat_id: chatId }, (members) => {
                showGroupProfile(chat, members);
            });
        } else {
            showUserProfile(chatId);
        }
    });
}

function showGroupProfile(chat, members) {
    const popup = document.getElementById('profile-popup');
    
    document.getElementById('popup-user-name').innerText = chat.name || 'Чат';
    
    const avatarEl = document.getElementById('popup-avatar');
    avatarEl.style.background = 'linear-gradient(135deg, #e76f51, #f4a261)';
    avatarEl.innerText = (chat.name || 'Ч').substring(0, 2).toUpperCase();
    
    document.getElementById('popup-name').innerText = chat.name || 'Чат';
    document.getElementById('popup-name').style.display = 'block';
    
    const typeLabel = chat.type === 'group' ? '👥 Группа' : '📢 Канал';
    document.getElementById('popup-username').innerText = `${typeLabel} • ${members ? members.length : 0} участников`;
    
    document.getElementById('popup-bio').innerHTML = '';
    document.getElementById('popup-bio').style.display = 'none';
    
    document.getElementById('popup-status').innerText = `Создан: ${new Date(chat.created_at).toLocaleDateString()}`;
    document.getElementById('popup-status').style.display = 'block';
    document.getElementById('popup-verified').innerHTML = '';
    document.getElementById('popup-created').innerHTML = '';
    
    let membersHtml = `
        <div style="margin-top:12px;border-top:1px solid var(--tg-border-color);padding-top:12px;">
            <div style="font-weight:600;margin-bottom:8px;font-size:15px;">👥 Участники (${members ? members.length : 0})</div>
    `;
    
    if (members && members.length > 0) {
        members.forEach(m => {
            const isOwner = m.role === 'owner';
            membersHtml += `
                <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--tg-border-color);cursor:pointer;" onclick="showUserProfile('${m.telegram_id}')">
                    <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg, #5085b1, #366187);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:600;font-size:12px;">${m.first_name.substring(0,2).toUpperCase()}</div>
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:14px;font-weight:500;display:flex;align-items:center;gap:4px;">
                            ${m.first_name} ${m.is_verified ? '✅' : ''}
                        </div>
                        <div style="font-size:11px;color:var(--tg-text-secondary);">
                            ${isOwner ? '👑 Владелец' : 'Участник'}
                            ${m.username ? ` • @${m.username}` : ''}
                        </div>
                    </div>
                </div>
            `;
        });
    }
    membersHtml += '</div>';
    
    const actionsDiv = document.getElementById('popup-actions');
    actionsDiv.innerHTML = `
        <button class="btn-chat" onclick="addGroupMemberByUsername()">➕ Добавить участника</button>
        <button class="btn-block" onclick="leaveGroup('${chat.chat_id}')">🚪 Покинуть ${chat.type === 'group' ? 'группу' : 'канал'}</button>
        ${membersHtml}
    `;
    
    popup.classList.add('active');
}

// ============ ДОБАВЛЕНИЕ УЧАСТНИКА ПО USERNAME ============
function addGroupMemberByUsername() {
    if (!currentChatId) {
        showAlert('❌ Чат не выбран');
        return;
    }
    
    showModal({
        title: 'Добавить участника',
        subtitle: 'Введите username пользователя (например: username)',
        defaultValue: '',
        placeholder: 'username',
        maxLength: 32,
        confirmText: 'Добавить',
        cancelText: 'Отмена'
    }).then((username) => {
        if (username !== null && username.trim()) {
            const cleanUsername = username.trim().replace('@', '');
            
            if (!cleanUsername) {
                showAlert('❌ Введите корректный username');
                return;
            }
            
            const loading = document.createElement('div');
            loading.className = 'loading-overlay';
            loading.innerHTML = `
                <div class="loading-spinner"></div>
                <p>Добавление пользователя...</p>
            `;
            document.body.appendChild(loading);
            
            socket.emit('add_user_to_group', { 
                chat_id: currentChatId, 
                username: cleanUsername 
            }, (response) => {
                loading.remove();
                
                if (response && response.status === 'ok') {
                    showAlert('✅ Пользователь успешно добавлен!');
                    if (currentChatId) {
                        showGroupInfo(currentChatId);
                        loadChatsAndMessages();
                    }
                } else {
                    showAlert(`❌ Ошибка: ${response?.message || 'Не удалось добавить пользователя'}`);
                }
            });
        }
    });
}

// ============ ПОКИНУТЬ ГРУППУ ============
function leaveGroup(chatId) {
    showModal({
        title: 'Покинуть чат',
        subtitle: 'Вы уверены, что хотите покинуть этот чат?',
        defaultValue: '',
        placeholder: '',
        confirmText: 'Покинуть',
        cancelText: 'Отмена',
        allowEmpty: true
    }).then((confirmed) => {
        if (confirmed !== null) {
            socket.emit('leave_group', { chat_id: chatId }, (response) => {
                if (response && response.status === 'ok') {
                    showAlert('✅ Вы покинули чат');
                    closeProfilePopup();
                    const chatItem = document.getElementById(`chat-item-${chatId}`);
                    if (chatItem) chatItem.remove();
                    delete dynamicChats[chatId];
                    loadChatsAndMessages();
                } else {
                    showAlert(`❌ Ошибка: ${response?.message || 'Не удалось покинуть чат'}`);
                }
            });
        }
    });
}

function closeProfilePopup() {
    document.getElementById('profile-popup').classList.remove('active');
}

function toggleVerification(userId, verify) {
    if (MY_ID !== CONFIG.CREATOR_ID) {
        showAlert('❌ Только создатель может управлять верификацией!');
        return;
    }
    socket.emit('verify_user', { user_id: userId, verify: verify }, (response) => {
        if (response && response.status === 'ok') {
            showAlert(verify ? '✅ Пользователь верифицирован!' : '❌ Верификация снята');
            closeProfilePopup();
            loadChatsAndMessages();
            initProfile();
        }
    });
}

function blockUser() {
    showModal({
        title: 'Заблокировать',
        subtitle: 'Вы уверены, что хотите заблокировать этого пользователя?',
        defaultValue: '',
        placeholder: '',
        confirmText: 'Заблокировать',
        cancelText: 'Отмена',
        allowEmpty: true
    }).then((confirmed) => {
        if (confirmed !== null) {
            socket.emit('block_user', { block_id: currentUserData.telegram_id }, (response) => {
                if (response && response.status === 'ok') {
                    showAlert('✅ Пользователь заблокирован');
                    closeProfilePopup();
                }
            });
        }
    });
}

function editName() {
    const currentName = document.getElementById('user-name').innerText.replace(' ✅', '').replace('⭐', '');
    showModal({
        title: 'Изменить имя',
        subtitle: 'Введите новое имя',
        defaultValue: currentName || tgUser?.first_name || '',
        placeholder: 'Ваше имя',
        maxLength: 50,
        confirmText: 'Сохранить',
        cancelText: 'Отмена'
    }).then((newName) => {
        if (newName !== null && newName.trim()) {
            socket.emit('update_profile', { name: newName.trim() }, (response) => {
                if (response && response.status === 'ok') {
                    const nameEl = document.getElementById('user-name');
                    if (currentUserData && currentUserData.is_verified) {
                        nameEl.innerHTML = `${newName.trim()} <span class="verified-check"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#2f8cc9"/><path d="M9 12l2 2 4-4" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></span>`;
                    } else {
                        nameEl.innerText = newName.trim();
                    }
                    document.getElementById('profile-display-name').innerText = newName.trim();
                    showAlert('✅ Имя обновлено!');
                    socket.emit('get_user_info', { user_id: MY_ID }, (userInfo) => {
                        if (userInfo && userInfo.status === 'found') {
                            currentUserData = userInfo.user;
                        }
                    });
                }
            });
        }
    });
}

function editUsername() {
    const isCreator = MY_ID === CONFIG.CREATOR_ID;
    const currentUsername = MY_USERNAME || '';
    showModal({
        title: 'Изменить username',
        subtitle: 'Введите новый username (только латиница и цифры)',
        defaultValue: currentUsername,
        placeholder: 'username',
        maxLength: 32,
        confirmText: 'Сохранить',
        cancelText: 'Отмена'
    }).then((newUsername) => {
        if (newUsername !== null && newUsername.trim()) {
            const username = newUsername.trim().replace('@', '');
            socket.emit('check_username', { username: username }, (response) => {
                if (response && response.status === 'taken' && !isCreator) {
                    showAlert('❌ Этот username уже занят');
                    return;
                }
                socket.emit('update_profile', { username: username }, (response) => {
                    if (response && response.status === 'ok') {
                        MY_USERNAME = username;
                        document.getElementById('user-username').innerText = `@${username}`;
                        document.getElementById('profile-username-display').innerText = `@${username}`;
                        showAlert('✅ Username обновлен!');
                        socket.emit('get_user_info', { user_id: MY_ID }, (userInfo) => {
                            if (userInfo && userInfo.status === 'found') {
                                currentUserData = userInfo.user;
                            }
                        });
                    }
                });
            });
        }
    });
}

function editBio() {
    const currentBio = currentUserData?.bio || '';
    showModal({
        title: 'О себе',
        subtitle: 'Введите описание вашего профиля',
        defaultValue: currentBio,
        placeholder: 'Расскажите о себе...',
        maxLength: 200,
        confirmText: 'Сохранить',
        cancelText: 'Отмена'
    }).then((newBio) => {
        if (newBio !== null) {
            socket.emit('update_profile', { bio: newBio.trim() }, (response) => {
                if (response && response.status === 'ok') {
                    document.getElementById('profile-bio-display').innerText = newBio.trim() || 'Добавить описание';
                    showAlert('✅ О себе обновлено!');
                    socket.emit('get_user_info', { user_id: MY_ID }, (userInfo) => {
                        if (userInfo && userInfo.status === 'found') {
                            currentUserData = userInfo.user;
                        }
                    });
                }
            });
        }
    });
}

function changeAvatar() {
    showModal({
        title: 'Изменить аватар',
        subtitle: 'Введите URL вашего фото',
        defaultValue: '',
        placeholder: 'https://example.com/avatar.jpg',
        type: 'url',
        maxLength: 500,
        confirmText: 'Сохранить',
        cancelText: 'Отмена'
    }).then((url) => {
        if (url !== null && url.trim()) {
            const avatarEl = document.getElementById('user-avatar');
            avatarEl.src = url.trim();
            socket.emit('update_profile', { photo_url: url.trim() }, (response) => {
                if (response && response.status === 'ok') {
                    showAlert('✅ Аватар обновлен!');
                    socket.emit('get_user_info', { user_id: MY_ID }, (userInfo) => {
                        if (userInfo && userInfo.status === 'found') {
                            currentUserData = userInfo.user;
                        }
                    });
                }
            });
        }
    });
}

function changeLanguage() {
    showAlert('🌐 Выбор языка будет доступен в следующей версии');
}

// Ждём готовность и загружаем профиль
setTimeout(initProfile, 1000);

console.log('✅ Profile module loaded');
