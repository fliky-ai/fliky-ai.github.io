// ============ UI ФУНКЦИИ ============
let theme = 'dark';

function switchTab(tabName, element) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const targetScreen = document.getElementById(`screen-${tabName}`);
    if (targetScreen) targetScreen.classList.add('active');
    if (element) element.classList.add('active');
    
    const titles = {
        chats: 'Чаты',
        contacts: 'Контакты',
        settings: 'Настройки',
        profile: 'Профиль'
    };
    document.getElementById('header-title').innerText = titles[tabName] || 'Чаты';
    document.getElementById('search-results').style.display = 'none';
    
    if (tabName === 'contacts') {
        loadContacts();
    }
}

function toggleTheme() {
    const root = document.documentElement;
    if (theme === 'dark') {
        root.setAttribute('data-theme', 'light');
        theme = 'light';
        document.querySelector('.theme-switch').innerText = '☀️';
    } else {
        root.removeAttribute('data-theme');
        theme = 'dark';
        document.querySelector('.theme-switch').innerText = '🌙';
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
    document.getElementById('message-actions').classList.remove('active');
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
    document.getElementById('message-actions').classList.remove('active');
}

function copyMessage() {
    const msgEl = document.querySelector(`[data-message-id="${selectedMessageId}"]`);
    if (msgEl) {
        const text = msgEl.querySelector('span').innerText;
        navigator.clipboard.writeText(text).then(() => {
            alert('📋 Сообщение скопировано');
        });
    }
    document.getElementById('message-actions').classList.remove('active');
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
                    msgEl.querySelector('span').innerHTML = formatMessageText(newText.trim());
                }
            }
        });
    }
    document.getElementById('message-actions').classList.remove('active');
}

function deleteMessage() {
    if (confirm('🗑 Удалить сообщение?')) {
        socket.emit('delete_message', { message_id: selectedMessageId }, (response) => {
            if (response && response.status === 'ok') {
                const msgEl = document.querySelector(`[data-message-id="${selectedMessageId}"]`);
                if (msgEl) {
                    msgEl.closest('.message-wrapper').remove();
                }
            }
        });
    }
    document.getElementById('message-actions').classList.remove('active');
}

function pinMessage() {
    socket.emit('pin_message', { message_id: selectedMessageId }, (response) => {
        if (response && response.status === 'ok') {
            alert('📌 Сообщение закреплено');
        }
    });
    document.getElementById('message-actions').classList.remove('active');
}

// ============ КНОПКА СОЗДАНИЯ ЧАТА ============
function addCreateButton() {
    // Проверяем, есть ли уже кнопка
    if (document.getElementById('create-chat-btn')) return;
    
    const chatsScreen = document.getElementById('screen-chats');
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

// ============ СОЗДАНИЕ ГРУППЫ ============
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
    // Удаляем старый оверлей если есть
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
    input.addEventListener('input', function() {
        const btn = document.getElementById('create-confirm-btn');
        btn.disabled = !this.value.trim();
    });
    setTimeout(() => input.focus(), 100);
}

function closeNameInput() {
    const overlay = document.getElementById('name-input-overlay');
    if (overlay) overlay.remove();
}

function confirmCreate(type) {
    const input = document.getElementById('chat-name-input');
    const name = input.value.trim();
    if (!name) return;
    
    closeNameInput();
    
    // Показываем загрузку
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
            
            // Добавляем в список чатов
            if (!dynamicChats[chatId]) {
                dynamicChats[chatId] = {
                    first_name: chatName,
                    username: '',
                    chat_type: type,
                    invite_link: response.invite_link,
                    members_count: 1,
                    role: 'owner'
                };
            }
            
            // Создаем строку чата
            createChatRow(chatId, chatName, '', true);
            
            // Открываем созданный чат
            openChat(chatId, chatName, true);
            
            // Показываем инвайт-ссылку
            setTimeout(() => {
                alert(`✅ ${type === 'group' ? 'Группа' : 'Канал'} "${chatName}" создан!\n\n🔗 Инвайт-ссылка: dicegram.me/${response.invite_link}\n\n👥 Приглашайте друзей!`);
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
            if (response.already_member) {
                alert('Вы уже состоите в этом чате!');
                // Открываем чат
                socket.emit('get_group_info', { chat_id: response.chat_id }, (info) => {
                    if (info && info.status === 'found') {
                        const chat = info.chat;
                        if (!dynamicChats[chat.chat_id]) {
                            dynamicChats[chat.chat_id] = {
                                first_name: chat.name,
                                username: '',
                                chat_type: chat.type,
                                invite_link: chat.invite_link
                            };
                            createChatRow(chat.chat_id, chat.name, '', chat.type === 'channel');
                        }
                        openChat(chat.chat_id, chat.name, chat.type === 'channel');
                    }
                });
            } else {
                alert('✅ Вы присоединились к чату!');
                // Обновляем список чатов
                loadChatsAndMessages();
                // Открываем чат
                socket.emit('get_group_info', { chat_id: response.chat_id }, (info) => {
                    if (info && info.status === 'found') {
                        const chat = info.chat;
                        if (!dynamicChats[chat.chat_id]) {
                            dynamicChats[chat.chat_id] = {
                                first_name: chat.name,
                                username: '',
                                chat_type: chat.type,
                                invite_link: chat.invite_link
                            };
                            createChatRow(chat.chat_id, chat.name, '', chat.type === 'channel');
                        }
                        openChat(chat.chat_id, chat.name, chat.type === 'channel');
                    }
                });
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
        }
    });
}

function showGroupProfile(chat, members) {
    const popup = document.getElementById('profile-popup');
    document.getElementById('popup-user-name').innerText = chat.name;
    document.getElementById('popup-avatar').innerText = chat.name.substring(0, 2).toUpperCase();
    document.getElementById('popup-name').innerText = chat.name;
    document.getElementById('popup-username').innerText = `🔗 dicegram.me/${chat.invite_link}`;
    document.getElementById('popup-bio').innerText = `${chat.type === 'group' ? '👥 Группа' : '📢 Канал'} • ${members ? members.length : 0} участников`;
    document.getElementById('popup-status').innerText = `Создан: ${new Date(chat.created_at).toLocaleDateString()}`;
    document.getElementById('popup-verified').innerHTML = '';
    document.getElementById('popup-created').innerHTML = '';
    
    // Список участников
    let membersHtml = '<div style="margin-top:12px;border-top:1px solid var(--tg-border-color);padding-top:12px;"><div style="font-weight:600;margin-bottom:8px;">Участники:</div>';
    if (members && members.length > 0) {
        members.forEach(m => {
            const isOwner = m.role === 'owner';
            membersHtml += `
                <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--tg-border-color);">
                    <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg, #5085b1, #366187);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:600;font-size:12px;">${m.first_name.substring(0,2).toUpperCase()}</div>
                    <div style="flex:1;">
                        <div style="font-size:14px;font-weight:500;">${m.first_name} ${m.is_verified ? '✅' : ''}</div>
                        <div style="font-size:11px;color:var(--tg-text-secondary);">${isOwner ? '👑 Владелец' : 'Участник'}</div>
                    </div>
                </div>
            `;
        });
    }
    membersHtml += '</div>';
    
    const actionsDiv = document.getElementById('popup-actions');
    actionsDiv.innerHTML = `
        <button class="btn-chat" onclick="copyInviteLink('${chat.invite_link}')">🔗 Скопировать ссылку</button>
        <button class="btn-share" onclick="leaveGroup('${chat.chat_id}')">🚪 Покинуть ${chat.type === 'group' ? 'группу' : 'канал'}</button>
        ${membersHtml}
    `;
    
    popup.classList.add('active');
}

function copyInviteLink(link) {
    const fullLink = `dicegram.me/${link}`;
    navigator.clipboard.writeText(fullLink).then(() => {
        alert('🔗 Ссылка скопирована!');
    });
}

function leaveGroup(chatId) {
    if (confirm('Вы уверены, что хотите покинуть этот чат?')) {
        socket.emit('leave_group', { chat_id: chatId }, (response) => {
            if (response && response.status === 'ok') {
                alert('Вы покинули чат');
                closeProfilePopup();
                // Удаляем чат из списка
                const chatItem = document.getElementById(`chat-item-${chatId}`);
                if (chatItem) chatItem.remove();
                delete dynamicChats[chatId];
                loadChatsAndMessages();
            } else {
                alert(`❌ Ошибка: ${response?.message || 'Не удалось покинуть чат'}`);
            }
        });
    }
}

// ============ ОБНОВЛЕНИЕ ОТОБРАЖЕНИЯ ГРУПП/КАНАЛОВ ============
function updateChatDisplay(chat) {
    const chatId = chat.chat_id || chat.partner_id;
    const name = chat.name || chat.partner_name;
    const isChannel = chat.type === 'channel';
    const isGroup = chat.type === 'group';
    const isVerified = chat.is_verified || false;
    
    // Обновляем существующий чат или создаем новый
    const existing = document.getElementById(`chat-item-${chatId}`);
    if (existing) {
        // Обновляем название
        const nameEl = existing.querySelector('.chat-name');
        if (nameEl) {
            nameEl.innerHTML = `${name} ${isVerified ? '✅' : ''} ${isChannel ? '📢' : isGroup ? '👥' : ''}`;
        }
        // Обновляем превью
        const previewEl = existing.querySelector('.chat-preview');
        if (previewEl && chat.last_message) {
            previewEl.innerText = chat.last_message;
        }
        return;
    }
    
    // Создаем новую строку
    createChatRow(chatId, name, chat.username || '', isVerified, isChannel ? 'channel' : isGroup ? 'group' : 'private');
}

// ============ ИНИЦИАЛИЗАЦИЯ ============
// Добавляем кнопку создания после загрузки
setTimeout(addCreateButton, 2000);

// Обработчик для вставки ссылки (можно добавить в поиск)
document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && e.target.id === 'global-search') {
        const query = e.target.value.trim();
        if (query.startsWith('dicegram.me/') || query.startsWith('https://dicegram.me/')) {
            e.preventDefault();
            const link = query.replace('https://', '').replace('dicegram.me/', '').trim();
            if (link) {
                joinByInvite(link);
                e.target.value = '';
                document.getElementById('search-results').style.display = 'none';
            }
        }
    }
});
