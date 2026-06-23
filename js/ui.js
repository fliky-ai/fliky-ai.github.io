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

// ============ КНОПКА СОЗДАНИЯ ============
function addCreateButton() {
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

// ============ ИСПРАВЛЕНО: СОЗДАНИЕ ЧАТА БЕЗ ИНВАЙТОВ ============
function confirmCreate(type) {
    const input = document.getElementById('chat-name-input');
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
            const chatType = response.type || type;
            
            if (!dynamicChats[chatId]) {
                dynamicChats[chatId] = {
                    first_name: chatName,
                    username: '',
                    chat_type: chatType,
                    members_count: 1,
                    role: 'owner'
                };
            }
            
            createChatRow(chatId, chatName, '', true, chatType);
            openChat(chatId);
            
            setTimeout(() => {
                alert(`✅ ${chatType === 'group' ? 'Группа' : 'Канал'} "${chatName}" создан!`);
            }, 1000);
        } else {
            alert(`❌ Ошибка: ${response?.message || 'Неизвестная ошибка'}`);
        }
    });
}

// ============ ИСПРАВЛЕНО: ДОБАВЛЕНИЕ УЧАСТНИКА ПО ЮЗЕРНЕЙМУ ============
function addGroupMember() {
    if (!currentChatId) {
        alert('❌ Чат не выбран');
        return;
    }
    
    const username = prompt('Введите юзернейм пользователя для добавления (например, @username):');
    if (!username || !username.trim()) return;
    
    // Убираем @, если юзер его случайно написал
    const cleanUsername = username.trim().replace('@', '');
    
    // Шлём запрос на новое событие бэкенда
    socket.emit('add_user_to_group', { 
        chat_id: currentChatId, 
        username: cleanUsername 
    }, (response) => {
        if (response && response.status === 'ok') {
            alert('✅ Пользователь успешно добавлен!');
            loadChatsAndMessages();
            if (currentChatId) {
                showGroupInfo(currentChatId);
            }
        } else {
            alert(`❌ Ошибка: ${response?.message || 'Не удалось найти или добавить пользователя'}`);
        }
    });
}

// ============ ИНИЦИАЛИЗАЦИЯ ============
setTimeout(addCreateButton, 2000);
