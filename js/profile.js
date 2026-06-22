// ============ ПРОФИЛЬ ============
if (typeof currentUserData === 'undefined') {
    window.currentUserData = null;
}

// Нативный SVG верификации для профиля
const pVerifiedIconSvg = `<span class="verified-check" style="display: inline-flex; align-self: center; margin-left: 6px; vertical-align: middle;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#2f8cc9"/><path d="M9 12l2 2 4-4" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></span>`;

function initProfile() {
    if (socket && isConnected) {
        socket.emit('get_user_info', { user_id: MY_ID }, (userInfo) => {
            if (userInfo && userInfo.status === 'found') {
                currentUserData = userInfo.user;
                if (typeof MY_USERNAME !== 'undefined') {
                    MY_USERNAME = currentUserData.username || MY_USERNAME;
                }
                
                const fullName = currentUserData.first_name || (typeof tgUser !== 'undefined' ? tgUser.first_name : 'Пользователь');
                const displayName = currentUserData.last_name ? `${fullName} ${currentUserData.last_name}` : fullName;
                
                const nameEl = document.getElementById('user-name');
                if (nameEl) {
                    if (currentUserData.is_verified) {
                        nameEl.innerHTML = `${displayName} ${pVerifiedIconSvg}`;
                    } else {
                        nameEl.innerText = displayName;
                    }
                }
                
                const userUsername = document.getElementById('user-username');
                if (userUsername) userUsername.innerText = MY_USERNAME ? `@${MY_USERNAME}` : '';
                
                const profileUsernameDisplay = document.getElementById('profile-username-display');
                if (profileUsernameDisplay) profileUsernameDisplay.innerText = MY_USERNAME ? `@${MY_USERNAME}` : '';
                
                const profileDisplayName = document.getElementById('profile-display-name');
                if (profileDisplayName) profileDisplayName.innerText = displayName;
                
                if (document.getElementById('user-avatar')) {
                    updateAvatar('user-avatar', displayName, currentUserData.photo_url);
                }
                
                const bioDisplay = document.getElementById('profile-bio-display');
                if (bioDisplay) {
                    bioDisplay.innerText = currentUserData.bio || 'Добавить описание';
                }
            }
        });
    }
}

function updateAvatar(elementId, name, photoUrl) {
    const avatarEl = document.getElementById(elementId);
    if (!avatarEl) return;
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
    
    if (typeof dynamicChats !== 'undefined' && dynamicChats[userId] && (dynamicChats[userId].chat_type === 'group' || dynamicChats[userId].chat_type === 'channel')) {
        if (window.showGroupInfo) {
            window.showGroupInfo(userId);
        }
        return;
    }
    
    if (!socket || !isConnected) {
        alert('Нет соединения с сервером');
        return;
    }

    socket.emit('get_user_info', { user_id: userId }, (userInfo) => {
        if (userInfo && userInfo.status === 'found') {
            const user = userInfo.user;
            window.currentUserData = user;
            
            const popup = document.getElementById('profile-popup');
            if (!popup) return;
            
            const fullName = user.first_name || 'Пользователь';
            const displayName = user.last_name ? `${fullName} ${user.last_name}` : fullName;
            const isBot = user.is_bot === 1 || userId === CONFIG.BOTFATHER_ID;
            
            const popupUserName = document.getElementById('popup-user-name');
            if (popupUserName) popupUserName.innerText = displayName;
            
            const avatarEl = document.getElementById('popup-avatar');
            if (avatarEl) {
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
            }
            
            const nameEl = document.getElementById('popup-name');
            const isVerified = userId === CONFIG.CREATOR_ID || userId === CONFIG.SUPPORT_ID || user.is_verified;
            if (nameEl) {
                if (isVerified) {
                    nameEl.innerHTML = `${displayName} ${pVerifiedIconSvg}`;
                } else {
                    nameEl.innerText = displayName;
                }
            }
            
            const popupUsername = document.getElementById('popup-username');
            if (popupUsername) popupUsername.innerText = user.username ? `@${user.username}` : '';
            
            const statusEl = document.getElementById('popup-status');
            if (statusEl) {
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
            }
            
            const popupBio = document.getElementById('popup-bio');
            if (popupBio) {
                popupBio.innerText = user.bio || (isBot ? 'Бот создан в DICEGRAM' : 'Нет описания');
                popupBio.style.display = 'block';
            }
            
            const createdDate = user.created_at ? new Date(user.created_at).toLocaleDateString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            }) : 'Неизвестно';
            const popupCreated = document.getElementById('popup-created');
            if (popupCreated) {
                popupCreated.innerText = `📅 Зарегистрирован: ${createdDate}`;
                popupCreated.style.display = 'block';
            }
            
            const verifiedEl = document.getElementById('popup-verified');
            if (verifiedEl) {
                if (isVerified) {
                    verifiedEl.innerHTML = `
                        <div class="verified-box" style="display: flex; align-items: center; gap: 10px; background: rgba(47, 140, 201, 0.1); padding: 12px; border-radius: 10px; margin-top: 10px;">
                            <span class="icon">${pVerifiedIconSvg}</span>
                            <span style="font-size: 13px; text-align: left; color: var(--tg-text-color);">This account is verified as official by the representatives of Dicegram</span>
                        </div>
                    `;
                } else {
                    verifiedEl.innerHTML = '';
                }
            }
            
            const actionsDiv = document.getElementById('popup-actions');
            if (actionsDiv) {
                actionsDiv.innerHTML = '';
                
                const chatBtn = document.createElement('button');
                chatBtn.className = 'btn-chat';
                chatBtn.innerText = '💬 Написать';
                chatBtn.onclick = () => {
                    if (typeof dynamicChats !== 'undefined') {
                        if (!dynamicChats[userId]) {
                            dynamicChats[userId] = {
                                first_name: displayName,
                                username: user.username || ''
                            };
                            if (typeof createChatRow === 'function') createChatRow(userId, displayName, user.username || '', isVerified);
                        }
                    }
                    if (typeof openChat === 'function') openChat(userId, displayName, isVerified);
                    closeProfilePopup();
                };
                actionsDiv.appendChild(chatBtn);
                
                const shareBtn = document.createElement('button');
                shareBtn.className = 'btn-share';
                shareBtn.innerText = '🔗 Поделиться ссылкой';
                shareBtn.onclick = () => {
                    const shareUrl = `https://t.me/${user.username || userId}`;
                    if (navigator.share) {
                        navigator.share({ title: displayName, url: shareUrl }).catch(() => {});
                    } else {
                        navigator.clipboard.writeText(shareUrl).then(() => { alert('🔗 Ссылка скопирована!'); });
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
            }
            
            popup.classList.add('active');
        }
    });
}

function closeProfilePopup() {
    const popup = document.getElementById('profile-popup');
    if (popup) popup.classList.remove('active');
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
            if (typeof loadChatsAndMessages === 'function') loadChatsAndMessages();
            initProfile();
        }
    });
}

function blockUser() {
    if (confirm('🚫 Заблокировать пользователя?')) {
        socket.emit('block_user', { block_id: window.currentUserData.telegram_id }, (response) => {
            if (response && response.status === 'ok') {
                alert('Пользователь заблокирован');
                closeProfilePopup();
            }
        });
    }
}

function editName() {
    const nameContainer = document.getElementById('profile-display-name');
    if (!nameContainer) return;
    const currentName = nameContainer.innerText.trim();
    const defaultFirstName = (typeof tgUser !== 'undefined' && tgUser.first_name) ? tgUser.first_name : '';
    const newName = prompt('Введите новое имя:', currentName || defaultFirstName);
    
    if (newName && newName.trim()) {
        socket.emit('update_profile', { name: newName.trim() }, (response) => {
            if (response && response.status === 'ok') {
                const nameEl = document.getElementById('user-name');
                if (nameEl) {
                    if (currentUserData && currentUserData.is_verified) {
                        nameEl.innerHTML = `${newName.trim()} ${pVerifiedIconSvg}`;
                    } else {
                        nameEl.innerText = newName.trim();
                    }
                }
                document.getElementById('profile-display-name').innerText = newName.trim();
                alert('✅ Имя обновлено!');
                socket.emit('get_user_info', { user_id: MY_ID }, (userInfo) => {
                    if (userInfo && userInfo.status === 'found') {
                        currentUserData = userInfo.user;
                    }
                });
            }
        });
    }
}

function editUsername() {
    const isCreator = MY_ID === CONFIG.CREATOR_ID;
    const currentUsername = (typeof MY_USERNAME !== 'undefined') ? MY_USERNAME : '';
    const newUsername = prompt('Введите новый username:', currentUsername);
    
    if (newUsername && newUsername.trim()) {
        const username = newUsername.trim().replace('@', '');
        socket.emit('check_username', { username: username }, (response) => {
            if (response && response.status === 'taken' && !isCreator) {
                alert('❌ Этот username уже занят');
                return;
            }
            socket.emit('update_profile', { username: username }, (response) => {
                if (response && response.status === 'ok') {
                    if (typeof MY_USERNAME !== 'undefined') MY_USERNAME = username;
                    const userUsername = document.getElementById('user-username');
                    if (userUsername) userUsername.innerText = `@${username}`;
                    const profileUserDisplay = document.getElementById('profile-username-display');
                    if (profileUserDisplay) profileUserDisplay.innerText = `@${username}`;
                    alert('✅ Username обновлен!');
                    socket.emit('get_user_info', { user_id: MY_ID }, (userInfo) => {
                        if (userInfo && userInfo.status === 'found') {
                            currentUserData = userInfo.user;
                        }
                    });
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
                const bioDisplay = document.getElementById('profile-bio-display');
                if (bioDisplay) bioDisplay.innerText = newBio.trim() || 'Добавить описание';
                alert('✅ О себе обновлено!');
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
        const avatarEl = document.getElementById('user-avatar');
        if (avatarEl) avatarEl.src = url.trim();
        socket.emit('update_profile', { photo_url: url.trim() }, (response) => {
            if (response && response.status === 'ok') {
                alert('✅ Аватар обновлен!');
                socket.emit('get_user_info', { user_id: MY_ID }, (userInfo) => {
                    if (userInfo && userInfo.status === 'found') {
                        currentUserData = userInfo.user;
                    }
                });
            }
        });
    }
}

function changeLanguage() {
    alert('🌐 Выбор языка будет доступен в следующей версии');
}

setTimeout(initProfile, 1000);

