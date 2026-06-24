// ============ ПРОФИЛЬ ============
window.currentUserData = null;
let profileRetryCount = 0;
const MAX_PROFILE_RETRIES = 10;

function initProfile(callback) {
    console.log('📝 initProfile() вызван, попытка', profileRetryCount + 1);
    
    if (!window.MY_ID) {
        const savedUser = localStorage.getItem('dicegram_user');
        if (savedUser) {
            try {
                const user = JSON.parse(savedUser);
                if (user && user.id) {
                    window.MY_ID = user.id;
                    window.MY_USERNAME = user.username || '';
                    window.tgUser = {
                        id: user.id,
                        first_name: user.first_name || 'User',
                        username: user.username || '',
                        photo_url: user.photo_url || ''
                    };
                    console.log('👤 Восстановлен MY_ID из localStorage:', window.MY_ID);
                }
            } catch (e) {
                localStorage.removeItem('dicegram_user');
            }
        }
    }

    if (!window.MY_ID) {
        console.log('⏳ MY_ID ещё не установлен, повтор через 500мс');
        setTimeout(() => initProfile(callback), 500);
        return;
    }

    if (typeof socket === 'undefined' || !isConnected) {
        console.log('⏳ Сокет ещё не готов, повтор через 500мс');
        setTimeout(() => initProfile(callback), 500);
        return;
    }

    console.log('📥 Загрузка профиля для:', window.MY_ID);
    
    socket.emit('get_user_info', { user_id: window.MY_ID }, (userInfo) => {
        console.log('📨 Ответ get_user_info:', userInfo);
        
        if (userInfo && userInfo.status === 'found') {
            window.currentUserData = userInfo.user;
            window.MY_USERNAME = window.currentUserData.username || window.MY_USERNAME;
            
            const fullName = window.currentUserData.first_name || window.tgUser?.first_name || 'Пользователь';
            const displayName = window.currentUserData.last_name ? `${fullName} ${window.currentUserData.last_name}` : fullName;
            const usernameDisplay = window.currentUserData.username || window.MY_USERNAME || '';
            
            const nameEl = document.getElementById('user-name');
            if (nameEl) {
                if (window.currentUserData.is_verified) {
                    nameEl.innerHTML = `${displayName} <span class="verified-check"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#2f8cc9"/><path d="M9 12l2 2 4-4" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></span>`;
                } else {
                    nameEl.innerText = displayName;
                }
            }
            
            const usernameEl = document.getElementById('user-username');
            if (usernameEl) usernameEl.innerText = usernameDisplay ? `@${usernameDisplay}` : '';
            
            const profileUsernameEl = document.getElementById('profile-username-display');
            if (profileUsernameEl) profileUsernameEl.innerText = usernameDisplay ? `@${usernameDisplay}` : '';
            
            const profileNameEl = document.getElementById('profile-display-name');
            if (profileNameEl) profileNameEl.innerText = displayName;
            
            updateAvatar('user-avatar', displayName, window.currentUserData.photo_url);
            
            const bioEl = document.getElementById('profile-bio-display');
            if (bioEl) bioEl.innerText = window.currentUserData.bio || 'Добавить описание';
            
            const statusEl = document.getElementById('profile-status');
            if (statusEl) {
                if (window.currentUserData.is_online) {
                    statusEl.innerText = '🟢 В сети';
                    statusEl.style.color = 'var(--tg-status-online)';
                } else {
                    statusEl.innerText = 'Был(а) в сети недавно';
                    statusEl.style.color = 'var(--tg-text-secondary)';
                }
            }
            
            profileRetryCount = 0;
            console.log('✅ Профиль обновлён:', displayName, '@' + usernameDisplay);
            if (callback) callback(window.currentUserData);
        } else {
            profileRetryCount++;
            if (profileRetryCount < MAX_PROFILE_RETRIES) {
                setTimeout(() => initProfile(callback), 1000);
            } else {
                if (callback) callback(null);
            }
        }
    });
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

function refreshProfile() {
    console.log('🔄 Принудительное обновление профиля');
    profileRetryCount = 0;
    initProfile();
}

function showUserProfile(userId) {
    if (!userId) return;
    
    if (window.dynamicChats && window.dynamicChats[userId] && (window.dynamicChats[userId].chat_type === 'group' || window.dynamicChats[userId].chat_type === 'channel')) {
        if (window.showGroupInfo) window.showGroupInfo(userId);
        return;
    }
    
    if (typeof socket === 'undefined' || !isConnected) {
        if (typeof showAlert === 'function') showAlert('Нет соединения с сервером');
        return;
    }

    const currentConfig = window.CONFIG || {};

    socket.emit('get_user_info', { user_id: userId }, (userInfo) => {
        if (userInfo && userInfo.status === 'found') {
            const user = userInfo.user;
            const popup = document.getElementById('profile-popup');
            if (!popup) return;

            const fullName = user.first_name || 'Пользователь';
            const displayName = user.last_name ? `${fullName} ${user.last_name}` : fullName;
            const isBot = user.is_bot === 1 || userId === currentConfig.BOTFATHER_ID;
            
            const popupTitle = document.getElementById('popup-user-name');
            if (popupTitle) popupTitle.innerText = displayName;
            
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
            const isVerified = userId === currentConfig.CREATOR_ID || userId === currentConfig.SUPPORT_ID || user.is_verified;
            if (nameEl) {
                if (isVerified) {
                    nameEl.innerHTML = `${displayName} <span class="verified-check"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#2f8cc9"/><path d="M9 12l2 2 4-4" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></span>`;
                } else {
                    nameEl.innerText = displayName;
                }
            }
            
            const pUsername = document.getElementById('popup-username');
            if (pUsername) pUsername.innerText = user.username ? `@${user.username}` : '';
            
            const statusEl = document.getElementById('popup-status');
            if (statusEl) {
                if (isBot) {
                    statusEl.innerText = '🤖 Бот';
                    statusEl.style.color = 'var(--tg-text-secondary)';
                } else if (user.is_online) {
                    statusEl.innerText = '🟢 В сети';
                    statusEl.style.color = 'var(--tg-status-online)';
                } else {
                    statusEl.innerText = '⚪ Был(а) недавно';
                    statusEl.style.color = 'var(--tg-text-secondary)';
                }
            }
            
            const pBio = document.getElementById('popup-bio');
            if (pBio) {
                pBio.innerText = user.bio || (isBot ? 'Бот создан в DICEGRAM' : 'Нет описания');
                pBio.style.display = 'block';
            }
            
            const pCreated = document.getElementById('popup-created');
            if (pCreated) {
                const createdDate = user.created_at ? new Date(user.created_at).toLocaleDateString('ru-RU') : 'Неизвестно';
                pCreated.innerText = `📅 Зарегистрирован: ${createdDate}`;
                pCreated.style.display = 'block';
            }
            
            const verifiedEl = document.getElementById('popup-verified');
            if (verifiedEl) {
                verifiedEl.innerHTML = isVerified ? `<div class="verified-box"><span class="icon">✅</span><span>Official Dicegram Account</span></div>` : '';
            }
            
            const actionsDiv = document.getElementById('popup-actions');
            if (actionsDiv) {
                actionsDiv.innerHTML = '';
                const chatBtn = document.createElement('button');
                chatBtn.className = 'btn-chat';
                chatBtn.innerText = '💬 Написать';
                chatBtn.onclick = () => {
                    if (typeof openChat === 'function') openChat(userId);
                    else if (typeof window.openChat === 'function') window.openChat(userId);
                    closeProfilePopup();
                };
                actionsDiv.appendChild(chatBtn);
            }
            popup.classList.add('active');
        }
    });
}

function showGroupInfo(chatId) {
    if (!chatId) return;
    socket.emit('get_group_info', { chat_id: chatId }, (info) => {
        if (info && info.status === 'found') {
            const chat = info.chat;
            socket.emit('get_group_members', { chat_id: chatId }, (members) => showGroupProfile(chat, members));
        } else {
            showUserProfile(chatId);
        }
    });
}

// ==== ЗДЕСЬ БЫЛ ОБРЫВ В ТВОЕМ КОДЕ, Я ЕГО ВОССТАНОВИЛ ====
function showGroupProfile(chat, members) {
    const popup = document.getElementById('profile-popup');
    if (!popup) return;
    
    document.getElementById('popup-user-name').innerText = chat.name || 'Чат';
    
    const avatarEl = document.getElementById('popup-avatar');
    if (avatarEl) {
        avatarEl.style.background = 'linear-gradient(135deg, #e76f51, #f4a261)';
        avatarEl.innerText = (chat.name || 'Ч').substring(0, 2).toUpperCase();
    }
    
    const nameEl = document.getElementById('popup-name');
    if (nameEl) {
        nameEl.innerText = chat.name || 'Чат';
        nameEl.style.display = 'block';
    }
    
    const typeLabel = chat.type === 'group' ? '👥 Группа' : '📢 Канал';
    const usernameEl = document.getElementById('popup-username');
    if (usernameEl) usernameEl.innerText = `${typeLabel} • ${members ? members.length : 0} участников`;
    
    let membersHtml = `
        <div style="margin-top:12px;border-top:1px solid var(--tg-border-color);padding-top:12px;">
            <div style="font-weight:600;margin-bottom:8px;font-size:15px;">👥 Участники (${members ? members.length : 0})</div>
    `;
    
    if (members && members.length > 0) {
        members.forEach(m => {
            const isOwner = m.role === 'owner';
            membersHtml += `
                <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--tg-border-color);cursor:pointer;" onclick="showUserProfile('${m.telegram_id}')">
                    <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg, #5085b1, #366187);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:600;font-size:12px;">${(m.first_name || 'U').substring(0,2).toUpperCase()}</div>
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
        membersHtml += `</div>`;
    }

    const actionsDiv = document.getElementById('popup-actions');
    if (actionsDiv) {
        actionsDiv.innerHTML = '';
        const chatBtn = document.createElement('button');
        chatBtn.className = 'btn-chat';
        chatBtn.innerText = '💬 Открыть чат';
        chatBtn.onclick = () => {
            if (typeof openChat === 'function') openChat(chat.id || chat.chat_id);
            else if (typeof window.openChat === 'function') window.openChat(chat.id || chat.chat_id);
            closeProfilePopup();
        };
        actionsDiv.appendChild(chatBtn);
    }
    
    const bioEl = document.getElementById('popup-bio');
    if (bioEl) {
        bioEl.innerHTML = membersHtml;
        bioEl.style.display = 'block';
    }
    
    popup.classList.add('active');
}

function closeProfilePopup() {
    const popup = document.getElementById('profile-popup');
    if (popup) popup.classList.remove('active');
}

// Прописываем функции глобально
window.initProfile = initProfile;
window.refreshProfile = refreshProfile;
window.showUserProfile = showUserProfile;
window.showGroupInfo = showGroupInfo;
window.showGroupProfile = showGroupProfile;
window.closeProfilePopup = closeProfilePopup;
