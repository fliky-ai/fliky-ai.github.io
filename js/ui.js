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
    
    const searchRes = document.getElementById('search-results');
    if (searchRes) searchRes.style.display = 'none';
    
    if (tabName === 'contacts' && typeof loadContacts === 'function') {
        loadContacts();
    }
}

function toggleTheme() {
    const root = document.documentElement;
    if (theme === 'dark') {
        root.setAttribute('data-theme', 'light');
        theme = 'light';
        const sw = document.querySelector('.theme-switch');
        if (sw) sw.innerText = '☀️';
    } else {
        root.removeAttribute('data-theme');
        theme = 'dark';
        const sw = document.querySelector('.theme-switch');
        if (sw) sw.innerText = '🌙';
    }
}

function showMessageActions(messageId) {
    const actions = document.getElementById('message-actions');
    if (actions) {
        actions.classList.toggle('active');
        window.selectedMessageId = messageId; // Привязываем к глобальному окну
    }
}

function replyToMessage() {
    if (typeof showModal !== 'function') return;
    showModal({
        title: 'Ответить',
        subtitle: 'Введите текст ответа',
        defaultValue: '',
        placeholder: 'Ваш ответ...',
        maxLength: 1000,
        confirmText: 'Отправить',
        cancelText: 'Отмена'
    }).then((text) => {
        if (text !== null && text.trim()) {
            socket.emit('send_message', { 
                receiver_id: window.currentChatId, 
                text: text.trim(),
                reply_to_id: window.selectedMessageId
            }, (response) => {
                if (response && response.status === 'ok' && typeof scrollToBottom === 'function') {
                    scrollToBottom();
                }
            });
        }
    });
    const actions = document.getElementById('message-actions');
    if (actions) actions.classList.remove('active');
}

function forwardMessage() {
    if (typeof showModal !== 'function') return;
    showModal({
        title: 'Переслать',
        subtitle: 'Введите ID пользователя или чата',
        defaultValue: '',
        placeholder: 'ID пользователя',
        maxLength: 50,
        confirmText: 'Переслать',
        cancelText: 'Отмена'
    }).then((chatId) => {
        if (chatId !== null && chatId.trim()) {
            socket.emit('forward_message', { 
                message_id: window.selectedMessageId,
                to_id: chatId.trim()
            }, (response) => {
                if (response && response.status === 'ok' && typeof showAlert === 'function') {
                    showAlert('✅ Сообщение переслано');
                }
            });
        }
    });
    const actions = document.getElementById('message-actions');
    if (actions) actions.classList.remove('active');
}

function copyMessage() {
    const msgEl = document.querySelector(`[data-message-id="${window.selectedMessageId}"]`);
    if (msgEl) {
        const textSpan = msgEl.querySelector('span');
        const text = textSpan ? textSpan.innerText : '';
        navigator.clipboard.writeText(text).then(() => {
            if (typeof showAlert === 'function') showAlert('📋 Сообщение скопировано');
        });
    }
    const actions = document.getElementById('message-actions');
    if (actions) actions.classList.remove('active');
}

function editMessage() {
    const msgEl = document.querySelector(`[data-message-id="${window.selectedMessageId}"]`);
    const textSpan = msgEl ? msgEl.querySelector('span') : null;
    const currentText = textSpan ? textSpan.innerText : '';
    
    if (typeof showModal !== 'function') return;
    showModal({
        title: 'Редактировать',
        subtitle: 'Измените текст сообщения',
        defaultValue: currentText,
        placeholder: 'Новый текст...',
        maxLength: 1000,
        confirmText: 'Сохранить',
        cancelText: 'Отмена'
    }).then((newText) => {
        if (newText !== null && newText.trim()) {
            socket.emit('edit_message', { 
                message_id: window.selectedMessageId,
                text: newText.trim()
            }, (response) => {
                if (response && response.status === 'ok') {
                    const refreshMsgEl = document.querySelector(`[data-message-id="${window.selectedMessageId}"]`);
                    if (refreshMsgEl) {
                        const refreshSpan = refreshMsgEl.querySelector('span');
                        if (refreshSpan) {
                            refreshSpan.innerHTML = typeof formatMessageText === 'function' ? formatMessageText(newText.trim()) : newText.trim();
                        }
                    }
                }
            });
        }
    });
    const actions = document.getElementById('message-actions');
    if (actions) actions.classList.remove('active');
}

function deleteMessage() {
    if (typeof showModal !== 'function') return;
    showModal({
        title: 'Удалить сообщение',
        subtitle: 'Вы уверены, что хотите удалить это сообщение?',
        defaultValue: '',
        placeholder: '',
        confirmText: 'Удалить',
        cancelText: 'Отмена',
        allowEmpty: true
    }).then((confirmed) => {
        if (confirmed !== null) {
            socket.emit('delete_message', { message_id: window.selectedMessageId }, (response) => {
                if (response && response.status === 'ok') {
                    const msgEl = document.querySelector(`[data-message-id="${window.selectedMessageId}"]`);
                    if (msgEl) {
                        const wrapper = msgEl.closest('.message-wrapper');
                        if (wrapper) wrapper.remove();
                    }
                }
            });
        }
    });
    const actions = document.getElementById('message-actions');
    if (actions) actions.classList.remove('active');
}

function pinMessage() {
    socket.emit('pin_message', { message_id: window.selectedMessageId }, (response) => {
        if (response && response.status === 'ok' && typeof showAlert === 'function') {
            showAlert('📌 Сообщение закреплено');
        }
    });
    const actions = document.getElementById('message-actions');
    if (actions) actions.classList.remove('active');
}

// ============ КНОПКА СОЗДАНИЯ ============
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

// ============ СОЗДАНИЕ ГРУППЫ / КАНАЛА ============
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
        if (btn) btn.disabled = !this.value.trim();
    });
    setTimeout(() => { if(input) input.focus(); }, 100);
}

function closeNameInput() {
    const overlay = document.getElementById('name-input-overlay');
    if (overlay) overlay.remove();
}

// ============ СВЯЗУЮЩЕЕ СОЗДАНИЕ ЧАТА ============
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
            const chatType = response.type || type;
            
            // Безопасное добавление в глобальный объект dynamicChats
            if (!window.dynamicChats) window.dynamicChats = {};
            if (!window.dynamicChats[chatId]) {
                window.dynamicChats[chatId] = {
                    first_name: chatName,
                    username: '',
                    chat_type: chatType,
                    members_count: 1,
                    role: 'owner'
                };
            }
            
            // Вызываем глобальные функции отрисовки и открытия из chats.js
            if (typeof window.createChatRow === 'function') {
                window.createChatRow(chatId, chatName, '', true, chatType);
            } else if (typeof createChatRow === 'function') {
                createChatRow(chatId, chatName, '', true, chatType);
            }

            if (typeof window.openChat === 'function') {
                window.openChat(chatId);
            } else if (typeof openChat === 'function') {
                openChat(chatId);
            }
            
            setTimeout(() => {
                if (typeof showAlert === 'function') {
                    showAlert(`✅ ${chatType === 'group' ? 'Группа' : 'Канал'} "${chatName}" создан!`);
                }
            }, 1000);
        } else {
            if (typeof showAlert === 'function') {
                showAlert(`❌ Ошибка: ${response?.message || 'Неизвестная ошибка'}`);
            }
        }
    });
}

// ============ ДОБАВЛЕНИЕ УЧАСТНИКА ============
function addGroupMember() {
    if (!window.currentChatId) {
        if (typeof showAlert === 'function') showAlert('❌ Чат не выбран');
        return;
    }
    
    if (typeof showModal !== 'function') return;
    showModal({
        title: 'Добавить участника',
        subtitle: 'Введите юзернейм пользователя (например, username)',
        defaultValue: '',
        placeholder: 'username',
        maxLength: 32,
        confirmText: 'Добавить',
        cancelText: 'Отмена'
    }).then((username) => {
        if (username !== null && username.trim()) {
            const cleanUsername = username.trim().replace('@', '');
            
            socket.emit('add_user_to_group', { 
                chat_id: window.currentChatId, 
                username: cleanUsername 
            }, (response) => {
                if (response && response.status === 'ok') {
                    if (typeof showAlert === 'function') showAlert('✅ Пользователь успешно добавлен!');
                    if (typeof loadChatsAndMessages === 'function') loadChatsAndMessages();
                    if (window.currentChatId && typeof showGroupInfo === 'function') {
                        showGroupInfo(window.currentChatId);
                    }
                } else {
                    if (typeof showAlert === 'function') {
                        showAlert(`❌ Ошибка: ${response?.message || 'Не удалось найти или добавить пользователя'}`);
                    }
                }
            });
        }
    });
}

// ============ ИНИЦИАЛИЗАЦИЯ ============
setTimeout(addCreateButton, 2000);
console.log('✅ UI module loaded (исправленная версия)');
