// ============ UI ФУНКЦИИ ============
let theme = 'dark';

function switchTab(tabName, element) {
    // Скрываем абсолютно все экраны
    document.querySelectorAll('.screen').forEach(s => {
        s.classList.remove('active');
        s.style.display = 'none'; // Полностью убираем старый экран из видимости
    });
    
    // Убираем активный класс у кнопок нижнего меню
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    
    // Находим целевой экран
    const targetScreen = document.getElementById(`screen-${tabName}`);
    if (targetScreen) {
        targetScreen.classList.add('active');
        
        // Специальная проверка для экрана профиля, чтобы он вставал ровно и красиво
        if (tabName === 'profile') {
            targetScreen.style.setProperty('display', 'flex', 'important');
        } else {
            targetScreen.style.display = 'block';
        }
    }
    
    // Подсвечиваем активную кнопку в нижнем меню
    if (element) element.classList.add('active');
    
    const titles = {
        chats: 'Чаты',
        contacts: 'Контакты',
        settings: 'Настройки',
        profile: 'Профиль'
    };
    
    const headerTitle = document.getElementById('header-title');
    if (headerTitle) headerTitle.innerText = titles[tabName] || 'Чаты';
    
    const searchResults = document.getElementById('search-results');
    if (searchResults) searchResults.style.display = 'none';
    
    if (tabName === 'contacts') {
        loadContacts();
    }
}

function toggleTheme() {
    const root = document.documentElement;
    if (theme === 'dark') {
        root.setAttribute('data-theme', 'light');
        theme = 'light';
        const themeSwitch = document.querySelector('.theme-switch');
        if (themeSwitch) themeSwitch.innerText = '☀️';
    } else {
        root.removeAttribute('data-theme');
        theme = 'dark';
        const themeSwitch = document.querySelector('.theme-switch');
        if (themeSwitch) themeSwitch.innerText = '🌙';
    }
}

function showMessageActions(messageId) {
    const actions = document.getElementById('message-actions');
    if (actions) {
        actions.classList.toggle('active');
        selectedMessageId = messageId;
    }
}

function replyToMessage() {
    const text = prompt('Введите ответ:');
    if (text && text.trim()) {
        socket.emit('send_message', { 
            receiver_id: currentChatId, 
            text: text.trim(),
            reply_to_id: selectedMessageId
        }, (response) => {
            if (response && response.status === 'ok') {
                renderSingleMessage(response.message);
                scrollToBottom();
            }
        });
    }
    const actions = document.getElementById('message-actions');
    if (actions) actions.classList.remove('active');
}

function forwardMessage() {
    const chatId = prompt('Введите ID пользователя для пересылки:');
    if (chatId && chatId.trim()) {
        socket.emit('forward_message', { 
            message_id: selectedMessageId,
            to_id: chatId.trim()
        }, (response) => {
            if (response && response.status === 'ok') {
                alert('✅ Сообщение переслано');
            }
        });
    }
    const actions = document.getElementById('message-actions');
    if (actions) actions.classList.remove('active');
}

function copyMessage() {
    const msgEl = document.querySelector(`[data-message-id="${selectedMessageId}"]`);
    if (msgEl) {
        const textSpan = msgEl.querySelector('span');
        const text = textSpan ? textSpan.innerText : '';
        navigator.clipboard.writeText(text).then(() => {
            alert('📋 Сообщение скопировано');
        });
    }
    const actions = document.getElementById('message-actions');
    if (actions) actions.classList.remove('active');
}

function editMessage() {
    const newText = prompt('Введите новый текст:');
    if (newText && newText.trim()) {
        socket.emit('edit_message', { 
            message_id: selectedMessageId,
            text: newText.trim()
        }, (response) => {
            if (response && response.status === 'ok') {
                const msgEl = document.querySelector(`[data-message-id="${selectedMessageId}"]`);
                if (msgEl) {
                    const textSpan = msgEl.querySelector('span');
                    if (textSpan) textSpan.innerHTML = formatMessageText(newText.trim());
                }
            }
        });
    }
    const actions = document.getElementById('message-actions');
    if (actions) actions.classList.remove('active');
}

function deleteMessage() {
    if (confirm('🗑 Удалить сообщение?')) {
        socket.emit('delete_message', { message_id: selectedMessageId }, (response) => {
            if (response && response.status === 'ok') {
                const msgEl = document.querySelector(`[data-message-id="${selectedMessageId}"]`);
                if (msgEl) {
                    const wrapper = msgEl.closest('.message-wrapper');
                    if (wrapper) wrapper.remove();
                }
            }
        });
    }
    const actions = document.getElementById('message-actions');
    if (actions) actions.classList.remove('active');
}

function pinMessage() {
    socket.emit('pin_message', { message_id: selectedMessageId }, (response) => {
        if (response && response.status === 'ok') {
            alert('📌 Сообщение закреплено');
        }
    });
    const actions = document.getElementById('message-actions');
    if (actions) actions.classList.remove('active');
}

// ============ КНОПКА СОЗДАНИЯ ЧАТА ============
function addCreateButton() {
    if (document.getElementById('create-chat-btn')) return;
    
    const chatsScreen = document.getElementById('screen-chats');
    if (!chatsScreen) return;
    
    const button = document.createElement('button');
    button.id = 'create-chat-btn';
    button.className = 'create-chat-btn';
    button.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
    `;
    button.onclick = showCreateMenu;
    chatsScreen.appendChild(button);
}

// ============ МЕНЮ СОЗДАНИЯ ============
function showCreateMenu() {
    let menu = document.getElementById('create-menu');
    if (!menu) {
        menu = document.createElement('div');
        menu.id = 'create-menu';
        menu.className = 'create-menu';
        menu.innerHTML = `
            <div class="create-menu-overlay" onclick="closeCreateMenu()"></div>
            <div class="create-menu-content">
                <div class="create-menu-item" onclick="createGroup()">
                    <div class="create-menu-icon" style="background: #5288c1;">
                        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
                            <circle cx="12" cy="8" r="4"/>
                            <path d="M5 20v-2a7 7 0 0 1 14 0v2"/>
                        </svg>
                    </div>
                    <div>
                        <div class="create-menu-title">Создать группу</div>
                        <div class="create-menu-sub">Создайте группу для общения</div>
                    </div>
                </div>
                <div class="create-menu-item" onclick="createChannel()">
                    <div class="create-menu-icon" style="background: #2a9d8f;">
                        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
                            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/>
                            <circle cx="12" cy="12" r="3"/>
                        </svg>
                    </div>
                    <div>
                        <div class="create-menu-title">Создать канал</div>
                        <div class="create-menu-sub">Создайте канал для публикаций</div>
                    </div>
                </div>
                <div class="create-menu-item" onclick="closeCreateMenu()">
                    <div class="create-menu-icon" style="background: #ff3b30;">
                        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </div>
                    <div>
                        <div class="create-menu-title">Отмена</div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(menu);
    }
    menu.classList.add('active');
}

function closeCreateMenu() {
    const menu = document.getElementById('create-menu');
    if (menu) menu.classList.remove('active');
}

function createGroup() {
    closeCreateMenu();
    showNameInput('group');
}

function createChannel() {
    closeCreateMenu();
    showNameInput('channel');
}

// ============ ВВОД НАЗВАНИЯ ============
function showNameInput(type) {
    const oldOverlay = document.getElementById('name-input-overlay');
    if (oldOverlay) oldOverlay.remove();
    
    const overlay = document.createElement('div');
    overlay.className = 'name-input-overlay';
    overlay.id = 'name-input-overlay';
    overlay.innerHTML = `
        <div class="name-input-content">
            <div class="name-input-header">
                <h3>${type === 'group' ? 'Создать группу' : 'Создать канал'}</h3>
                <button onclick="closeNameInput()">✕</button>
            </div>
            <div class="name-input-body">
                <label>Введите название ${type === 'group' ? 'группы' : 'канала'}</label>
                <input type="text" id="chat-name-input" placeholder="Название..." maxlength="100" autofocus>
            </div>
            <div class="name-input-footer">
                <button onclick="closeNameInput()">Отмена</button>
                <button id="create-confirm-btn" onclick="confirmCreate('${type}')" disabled>Далее</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    
    const input = document.getElementById('chat-name-input');
    if (input) {
        input.addEventListener('input', function() {
            const btn = document.getElementById('create-confirm-btn');
            if (btn) btn.disabled = !this.value.trim();
        });
        setTimeout(() => input.focus(), 100);
    }
}

function closeNameInput() {
    const overlay = document.getElementById('name-input-overlay');
    if (overlay) overlay.remove();
}

function confirmCreate(type) {
    const input = document.getElementById('chat-name-input');
    if (!input) return;
    const name = input.value.trim();
    if (!name) return;
    
    closeNameInput();
    
    const loading = document.createElement('div');
    loading.className = 'loading-overlay';
    loading.innerHTML = `
        <div class="loading-spinner"></div>
        <p>Создание ${type === 'group' ? 'группы' : 'канала'}...</p>
    `;
    document.body.appendChild(loading);
    
    const event = type === 'group' ? 'create_group' : 'create_channel';
    socket.emit(event, { name: name }, (response) => {
        loading.remove();
        
        if (response && response.status === 'ok') {
            const chatId = response.chat_id;
            const chatName = response.name;
            
            if (typeof dynamicChats !== 'undefined' && !dynamicChats[chatId]) {
                dynamicChats[chatId] = {
                    first_name: chatName,
                    username: '',
                    chat_type: type,
                    invite_link: response.invite_link,
                    members_count: 1,
                    role: 'owner'
                };
            }
            
            if (typeof createChatRow === 'function') {
                createChatRow(chatId, chatName, '', true, type);
            }
            if (typeof openChat === 'function') {
                openChat(chatId, chatName, true);
            }
            
            setTimeout(() => {
                alert(`✅ ${type === 'group' ? 'Группа' : 'Канал'} "${chatName}" создан!\n\n🔗 Инвайт-ссылка: dicegram.me/${response.invite_link}`);
            }, 1000);
            
        } else {
            alert(`❌ Ошибка: ${response?.message || 'Неизвестная ошибка'}`);
        }
    });
}

// ============ ПРИСОЕДИНЕНИЕ ПО ССЫЛКЕ ============
function joinByInvite(link) {
    if (!socket || !isConnected) {
        alert('Нет соединения с сервером');
        return;
    }
    
    socket.emit('join_by_invite', { link: link }, (response) => {
        if (response && response.status === 'ok') {
            const openTargetChat = () => {
                socket.emit('get_group_info', { chat_id: response.chat_id }, (info) => {
                    if (info && info.status === 'found') {
                        const chat = info.chat;
                        if (typeof dynamicChats !== 'undefined' && !dynamicChats[chat.chat_id]) {
                            dynamicChats[chat.chat_id] = {
                                first_name: chat.name,
                                username: '',
                                chat_type: chat.type,
                                invite_link: chat.invite_link
                            };
                            if (typeof createChatRow === 'function') {
                                createChatRow(chat.chat_id, chat.name, '', chat.type === 'channel', chat.type);
                            }
                        }
                        if (typeof openChat === 'function') {
                            openChat(chat.chat_id, chat.name, chat.type === 'channel');
                        }
                    }
                });
            };

            if (response.already_member) {
                alert('Вы уже состоите в этом чате!');
                openTargetChat();
            } else {
                alert('✅ Вы присоединились к чату!');
                if (typeof loadChatsAndMessages === 'function') loadChatsAndMessages();
                openTargetChat();
            }
        } else {
            alert(`❌ Ошибка: ${response?.message || 'Не удалось присоединиться'}`);
        }
    });
}

// ============ ПОКАЗАТЬ ИНФОРМАЦИЮ О ГРУППЕ/КАНАЛЕ ============
function showGroupInfo(chatId) {
    if (!chatId) return;
    
    socket.emit('get_group_info', { chat_id: chatId }, (info) => {
        if (info && info.status === 'found') {
            const chat = info.chat;
            socket.emit('get_group_members', { chat_id: chatId }, (members) => {
                showGroupProfile(chat, members);
            });
        } else {
            if (window.showUserProfile) window.showUserProfile(chatId);
        }
    });
}

function showGroupProfile(chat, members) {
    const popup = document.getElementById('profile-popup');
    if (!popup) return;
    
    const popupUserName = document.getElementById('popup-user-name');
    if (popupUserName) popupUserName.innerText = chat.name || 'Чат';
    
    const avatarEl = document.getElementById('popup-avatar');
    if (avatarEl) {
        avatarEl.style.background = 'linear-gradient(135deg, #e76f51, #f4a261)';
        avatarEl.innerText = (chat.name || 'Ч').substring(0, 2).toUpperCase();
    }
    
    const popupName = document.getElementById('popup-name');
    if (popupName) {
        popupName.innerText = chat.name || 'Чат';
        popupName.style.display = 'block';
    }
    
    const typeLabel = chat.type === 'group' ? '👥 Группа' : '📢 Канал';
    const popupUsername = document.getElementById('popup-username');
    if (popupUsername) popupUsername.innerText = `${typeLabel} • ${members ? members.length : 0} участников`;
    
    const inviteLink = `dicegram.me/${chat.invite_link}`;
    const popupBio = document.getElementById('popup-bio');
    if (popupBio) {
        popupBio.innerHTML = `
            <div style="margin-top:8px;padding:8px 12px;background:rgba(82,136,193,0.1);border-radius:8px;border:1px solid rgba(82,136,193,0.2);">
                <div style="font-size:12px;color:var(--tg-text-secondary);">🔗 Инвайт-ссылка</div>
                <div style="font-size:14px;color:var(--tg-accent-color);cursor:pointer;word-break:break-all;" onclick="copyInviteLink('${chat.invite_link}')">
                    ${inviteLink}
                </div>
            </div>
        `;
    }
    
    const popupStatus = document.getElementById('popup-status');
    if (popupStatus) {
        popupStatus.innerText = `Создан: ${new Date(chat.created_at).toLocaleDateString()}`;
        popupStatus.style.display = 'block';
    }
    
    const popupVerified = document.getElementById('popup-verified');
    if (popupVerified) popupVerified.innerHTML = '';
    const popupCreated = document.getElementById('popup-created');
    if (popupCreated) popupCreated.innerHTML = '';
    
    const memberSvg = `<span class="verified-check" style="display: inline-flex; align-self: center; margin-left: 4px; vertical-align: middle;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#2f8cc9"/><path d="M9 12l2 2 4-4" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></span>`;
    
    let membersHtml = `
        <div style="margin-top:12px;border-top:1px solid var(--tg-border-color);padding-top:12px;">
            <div style="font-weight:600;margin-bottom:8px;font-size:15px;">👥 Участники (${members ? members.length : 0})</div>
    `;
    
    if (members && members.length > 0) {
        members.forEach(m => {
            const isOwner = m.role === 'owner';
            membersHtml += `
                <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--tg-border-color);cursor:pointer;" onclick="if(typeof closeProfilePopup === 'function') closeProfilePopup(); setTimeout(() => { if(window.showUserProfile) window.showUserProfile('${m.telegram_id}') }, 200);">
                    <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg, #5085b1, #366187);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:600;font-size:12px;">${(m.first_name || 'U').substring(0,2).toUpperCase()}</div>
                    <div style="flex:1;min-width:0;text-align:left;">
                        <div style="font-size:14px;font-weight:500;display:flex;align-items:center;gap:4px;">
                            ${m.first_name} ${m.is_verified ? memberSvg : ''}
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
    if (actionsDiv) {
        actionsDiv.innerHTML = `
            <button class="btn-chat" onclick="copyInviteLink('${chat.invite_link}')">🔗 Скопировать ссылку</button>
            <button class="btn-share" onclick="shareInviteLink('${chat.invite_link}')">📤 Поделиться</button>
            <button class="btn-block" onclick="leaveGroup('${chat.chat_id}')">🚪 Покинуть ${chat.type === 'group' ? 'группу' : 'канал'}</button>
            ${membersHtml}
        `;
    }
    
    popup.classList.add('active');
}

function copyInviteLink(link) {
    const fullLink = `dicegram.me/${link}`;
    navigator.clipboard.writeText(fullLink).then(() => {
        alert('🔗 Ссылка скопирована в буфер обмена!');
    });
}

function shareInviteLink(link) {
    const fullLink = `dicegram.me/${link}`;
    if (navigator.share) {
        navigator.share({
            title: 'Приглашение в DICEGRAM',
            text: 'Присоединяйся к чату в DICEGRAM!',
            url: `https://${fullLink}`
        }).catch(() => {});
    } else {
        copyInviteLink(link);
    }
}

function leaveGroup(chatId) {
    if (confirm('Вы уверены, что хотите покинуть этот чат?')) {
        socket.emit('leave_group', { chat_id: chatId }, (response) => {
            if (response && response.status === 'ok') {
                alert('✅ Вы покинули чат');
                if (typeof closeProfilePopup === 'function') closeProfilePopup();
                const chatItem = document.getElementById(`chat-item-${chatId}`);
                if (chatItem) chatItem.remove();
                if (typeof dynamicChats !== 'undefined') delete dynamicChats[chatId];
                if (typeof loadChatsAndMessages === 'function') loadChatsAndMessages();
            } else {
                alert(`❌ Ошибка: ${response?.message || 'Не удалось покинуть чат'}`);
            }
        });
    }
}

// ============ ОБНОВЛЕНИЕ ОТОБРАЖЕНИЯ ГРУПП/КАНАЛОВ И СИНЯЯ ГАЛОЧКА ============
function updateChatDisplay(chat) {
    if (!chat) return;
    
    const chatId = chat.chat_id || chat.partner_id;
    const name = chat.name || chat.partner_name;
    const isChannel = chat.type === 'channel';
    const isGroup = chat.type === 'group';
    
    let isVerified = chat.is_verified;
    if (typeof CONFIG !== 'undefined') {
        isVerified = isVerified || (chatId === CONFIG.CREATOR_ID || chatId === CONFIG.SUPPORT_ID);
    }
    
    const listSvg = `<span class="verified-check" style="display: inline-flex; align-self: center; margin-left: 5px; vertical-align: middle;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#2f8cc9"/><path d="M9 12l2 2 4-4" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></span>`;
    
    const existing = document.getElementById(`chat-item-${chatId}`);
    if (existing) {
        const nameEl = existing.querySelector('.chat-name');
        if (nameEl) {
            nameEl.innerHTML = `${name}${isVerified ? listSvg : ''} ${isChannel ? '📢' : isGroup ? '👥' : ''}`;
        }
        const previewEl = existing.querySelector('.chat-preview');
        if (previewEl && chat.last_message) {
            previewEl.innerText = chat.last_message;
        }
    } else {
        if (typeof createChatRow === 'function') {
            createChatRow(chatId, name, chat.username || '', isVerified, isChannel ? 'channel' : isGroup ? 'group' : 'private');
        }
    }
}

// ============ ИНИЦИАЛИЗАЦИЯ ============
setTimeout(addCreateButton, 2000);

document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && e.target.id === 'global-search') {
        const query = e.target.value.trim();
        if (query.startsWith('dicegram.me/') || query.startsWith('https://dicegram.me/')) {
            e.preventDefault();
            const link = query.replace('https://', '').replace('dicegram.me/', '').trim();
            if (link) {
                joinByInvite(link);
                e.target.value = '';
                const searchResults = document.getElementById('search-results');
                if (searchResults) searchResults.style.display = 'none';
            }
        }
    }
});
