// ============ ПРОФИЛЬ ============
let currentUserData = null;
let profileRetryCount = 0;
const MAX_PROFILE_RETRIES = 10;

function initProfile(callback) {
    console.log('📝 initProfile() вызван, попытка', profileRetryCount + 1);
    
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
        setTimeout(() => initProfile(callback), 500);
        return;
    }

    if (!socket || !isConnected) {
        console.log('⏳ Сокет ещё не готов, повтор через 500мс');
        setTimeout(() => initProfile(callback), 500);
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
            const usernameDisplay = currentUserData.username || MY_USERNAME || '';
            
            const nameEl = document.getElementById('user-name');
            if (nameEl) {
                if (currentUserData.is_verified) {
                    nameEl.innerHTML = `${displayName} <span class="verified-check"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#2f8cc9"/><path d="M9 12l2 2 4-4" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></span>`;
                } else {
                    nameEl.innerText = displayName;
                }
            }
            
            const usernameEl = document.getElementById('user-username');
            if (usernameEl) {
                usernameEl.innerText = usernameDisplay ? `@${usernameDisplay}` : '';
            }
            
            const profileUsernameEl = document.getElementById('profile-username-display');
            if (profileUsernameEl) {
                profileUsernameEl.innerText = usernameDisplay ? `@${usernameDisplay}` : '';
            }
            
            const profileNameEl = document.getElementById('profile-display-name');
            if (profileNameEl) {
                profileNameEl.innerText = displayName;
            }
            
            updateAvatar('user-avatar', displayName, currentUserData.photo_url);
            
            const bioEl = document.getElementById('profile-bio-display');
            if (bioEl) {
                bioEl.innerText = currentUserData.bio || 'Добавить описание';
            }
            
            const statusEl = document.getElementById('profile-status');
            if (statusEl) {
                if (currentUserData.is_online) {
                    statusEl.innerText = '🟢 В сети';
                    statusEl.style.color = 'var(--tg-status-online)';
                } else {
                    statusEl.innerText = 'Был(а) в сети недавно';
                    statusEl.style.color = 'var(--tg-text-secondary)';
                }
            }
            
            profileRetryCount = 0;
            console.log('✅ Профиль обновлён:', displayName, '@' + usernameDisplay);
            
            if (callback) {
                callback(currentUserData);
            }
        } else {
            profileRetryCount++;
            if (profileRetryCount < MAX_PROFILE_RETRIES) {
                console.log(`⚠️ Пользователь не найден, попытка ${profileRetryCount}/${MAX_PROFILE_RETRIES}`);
                setTimeout(() => initProfile(callback), 1000);
            } else {
                console.log('❌ Не удалось загрузить профиль после всех попыток');
                if (callback) {
                    callback(null);
                }
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

// ============ ОБНОВЛЕНИЕ ПРОФИЛЯ ПОСЛЕ ИЗМЕНЕНИЙ ============
function refreshProfile() {
    console.log('🔄 Принудительное обновление профиля');
    profileRetryCount = 0;
    initProfile();
}

// ============ ОСТАЛЬНЫЕ ФУНКЦИИ (без изменений) ============
// showUserProfile, showGroupInfo, showGroupProfile, addGroupMemberByUsername, leaveGroup, closeProfilePopup, toggleVerification, blockUser

// ============ РЕДАКТИРОВАНИЕ ПРОФИЛЯ (ИСПРАВЛЕНО) ============

function editName() {
    console.log('📝 editName() вызван');
    const currentNameEl = document.getElementById('user-name');
    const currentName = currentNameEl ? currentNameEl.innerText.replace(' ✅', '').replace('⭐', '').trim() : '';
    
    showModal({
        title: '✏️ Изменить имя',
        subtitle: 'Введите новое имя',
        defaultValue: currentName || tgUser?.first_name || '',
        placeholder: 'Ваше имя',
        maxLength: 50,
        confirmText: 'Сохранить',
        cancelText: 'Отмена'
    }).then((newName) => {
        console.log('📝 Результат модалки:', newName);
        if (newName !== null && newName.trim()) {
            const name = newName.trim();
            console.log('📤 Отправка update_profile с именем:', name);
            socket.emit('update_profile', { name: name }, (response) => {
                console.log('📨 Ответ сервера:', response);
                if (response && response.status === 'ok') {
                    // Обновляем UI
                    const nameEl = document.getElementById('user-name');
                    if (nameEl) {
                        if (currentUserData && currentUserData.is_verified) {
                            nameEl.innerHTML = `${name} <span class="verified-check"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#2f8cc9"/><path d="M9 12l2 2 4-4" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></span>`;
                        } else {
                            nameEl.innerText = name;
                        }
                    }
                    const profileNameEl = document.getElementById('profile-display-name');
                    if (profileNameEl) profileNameEl.innerText = name;
                    
                    // Обновляем tgUser и localStorage
                    if (window.tgUser) window.tgUser.first_name = name;
                    const saved = localStorage.getItem('dicegram_user');
                    if (saved) {
                        try {
                            const userData = JSON.parse(saved);
                            userData.first_name = name;
                            localStorage.setItem('dicegram_user', JSON.stringify(userData));
                        } catch(e) {
                            console.error('Ошибка обновления localStorage:', e);
                        }
                    }
                    
                    showAlert('✅ Имя обновлено!');
                    refreshProfile();
                } else {
                    showAlert('❌ Ошибка: ' + (response?.message || 'Не удалось сохранить имя'));
                }
            });
        }
    });
}

function editUsername() {
    console.log('📝 editUsername() вызван');
    const isCreator = MY_ID === CONFIG.CREATOR_ID;
    const currentUsername = MY_USERNAME || '';
    
    showModal({
        title: '✏️ Изменить username',
        subtitle: 'Введите новый username (только латиница и цифры)',
        defaultValue: currentUsername,
        placeholder: 'username',
        maxLength: 32,
        confirmText: 'Сохранить',
        cancelText: 'Отмена'
    }).then((newUsername) => {
        console.log('📝 Результат модалки username:', newUsername);
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
                        const usernameEl = document.getElementById('user-username');
                        if (usernameEl) usernameEl.innerText = `@${username}`;
                        const profileUsernameEl = document.getElementById('profile-username-display');
                        if (profileUsernameEl) profileUsernameEl.innerText = `@${username}`;
                        
                        const saved = localStorage.getItem('dicegram_user');
                        if (saved) {
                            try {
                                const userData = JSON.parse(saved);
                                userData.username = username;
                                localStorage.setItem('dicegram_user', JSON.stringify(userData));
                            } catch(e) {}
                        }
                        
                        showAlert('✅ Username обновлен!');
                        refreshProfile();
                    }
                });
            });
        }
    });
}

function editBio() {
    console.log('📝 editBio() вызван');
    const currentBio = currentUserData?.bio || '';
    
    showModal({
        title: '✏️ О себе',
        subtitle: 'Введите описание вашего профиля',
        defaultValue: currentBio,
        placeholder: 'Расскажите о себе...',
        maxLength: 200,
        confirmText: 'Сохранить',
        cancelText: 'Отмена'
    }).then((newBio) => {
        console.log('📝 Результат модалки bio:', newBio);
        if (newBio !== null) {
            const bio = newBio.trim();
            socket.emit('update_profile', { bio: bio }, (response) => {
                if (response && response.status === 'ok') {
                    const bioEl = document.getElementById('profile-bio-display');
                    if (bioEl) bioEl.innerText = bio || 'Добавить описание';
                    showAlert('✅ О себе обновлено!');
                    refreshProfile();
                }
            });
        }
    });
}

function changeAvatar() {
    console.log('📝 changeAvatar() вызван');
    showModal({
        title: '✏️ Изменить аватар',
        subtitle: 'Введите URL вашего фото',
        defaultValue: '',
        placeholder: 'https://example.com/avatar.jpg',
        type: 'url',
        maxLength: 500,
        confirmText: 'Сохранить',
        cancelText: 'Отмена'
    }).then((url) => {
        console.log('📝 Результат модалки avatar:', url);
        if (url !== null && url.trim()) {
            const avatarEl = document.getElementById('user-avatar');
            if (avatarEl) avatarEl.src = url.trim();
            socket.emit('update_profile', { photo_url: url.trim() }, (response) => {
                if (response && response.status === 'ok') {
                    showAlert('✅ Аватар обновлен!');
                    refreshProfile();
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
