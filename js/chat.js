// ============ ЛОГИКА ЧАТОВ ============
let currentChatId = null;
let dynamicChats = {};
let unreadCounts = {};
let selectedMessageId = null;
let isInitialLoad = true;

// Загрузка чатов
function loadChatsAndMessages() {
    if (!socket || !isConnected) {
        console.log('⏳ Ожидание соединения...');
        setTimeout(loadChatsAndMessages, 1000);
        return;
    }

    console.log('📥 Загрузка чатов...');
    socket.emit('get_all_chats', {}, (chats) => {
        console.log('📨 Получены чаты:', chats?.length || 0);
        
        const chatsList = document.getElementById('chats-list');
        chatsList.innerHTML = '';
        
        if (chats && Array.isArray(chats)) {
            chats.forEach(chat => {
                const partnerId = chat.partner_id;
                if (partnerId && partnerId !== MY_ID) {
                    if (!dynamicChats[partnerId]) {
                        dynamicChats[partnerId] = {
                            first_name: chat.partner_name || `User ${partnerId}`,
                            username: chat.partner_username || `@user${partnerId}`
                        };
                    }
                    createChatRow(partnerId, dynamicChats[partnerId].first_name, dynamicChats[partnerId].username);
                    
                    if (chat.last_message) {
                        const previewEl = document.getElementById(`preview-${partnerId}`);
                        if (previewEl) previewEl.innerText = chat.last_message;
                    }
                    if (chat.unread_count > 0) {
                        unreadCounts[partnerId] = chat.unread_count;
                        updateUnreadBadge(partnerId, chat.unread_count);
                    }
                }
            });
        }
        
        if (chatsList.children.length === 0) {
            chatsList.innerHTML = `
                <div style="padding:40px 20px;text-align:center;color:var(--tg-text-secondary);">
                    <div style="font-size:48px;margin-bottom:16px;">💬</div>
                    <div style="font-size:16px;font-weight:500;">Нет чатов</div>
                    <div style="font-size:13px;margin-top:4px;">Начните переписку с помощью поиска</div>
                </div>
            `;
        }
    });
}

// Создание строки чата
function createChatRow(tgId, firstName, username) {
    if (!tgId) return;
    
    if (!dynamicChats[tgId]) {
        dynamicChats[tgId] = { first_name: firstName || `User ${tgId}`, username: username || '' };
    }
    
    const chatsList = document.getElementById('chats-list');
    if (document.getElementById(`chat-item-${tgId}`)) return;
    
    const isBotFather = username === 'botfather';
    const isSupport = tgId === '0';
    const isVerified = tgId === CONFIG.CREATOR_ID || username === 'botfather';
    const verifiedIcon = isVerified ? 
        `<svg class="tg-verify-icon" viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>` : '';
    
    const displayName = firstName || `User ${tgId}`;
    let avatarBg = 'linear-gradient(135deg, #5085b1, #366187)';
    if (isBotFather) avatarBg = 'linear-gradient(135deg, #2a9d8f, #264653)';
    else if (isSupport) avatarBg = 'linear-gradient(135deg, #5288c1, #1a3a5c)';
    
    const rowHTML = `
        <div class="chat-item" id="chat-item-${tgId}" onclick="openChat('${tgId}', '${displayName.replace(/'/g, "\\'")}', ${isVerified})">
            <div class="chat-avatar" style="background: ${avatarBg}">
                ${displayName.substring(0,2).toUpperCase()}
                ${isVerified ? '<span style="position:absolute;bottom:-2px;right:-2px;font-size:12px;">✓</span>' : ''}
            </div>
            <div class="chat-details">
                <div class="chat-title-row">
                    <div class="chat-name">${displayName} ${verifiedIcon}</div>
                    <div style="display:flex;align-items:center;gap:4px;">
                        <span class="chat-time" id="time-${tgId}"></span>
                        <span class="chat-unread-badge" id="unread-badge-${tgId}" style="display:none;">0</span>
                    </div>
                </div>
                <div class="chat-preview" id="preview-${tgId}">Нет сообщений</div>
            </div>
        </div>
    `;
    chatsList.insertAdjacentHTML('beforeend', rowHTML);
}

// Обновление счетчика непрочитанных
function updateUnreadBadge(chatId, count) {
    const badge = document.getElementById(`unread-badge-${chatId}`);
    if (badge) {
        if (count > 0) {
            badge.style.display = 'inline-block';
            badge.textContent = count;
        } else {
            badge.style.display = 'none';
        }
    }
}

// Открытие чата
function openChat(chatId, chatName, isVerified = false) {
    if (!chatId || !socket || !isConnected) {
        if (!socket || !isConnected) {
            alert('Нет соединения с сервером');
        }
        return;
    }

    currentChatId = chatId;
    
    unreadCounts[chatId] = 0;
    updateUnreadBadge(chatId, 0);
    
    const titleEl = document.getElementById('chat-room-title');
    titleEl.innerText = chatName || 'Чат';
    if (isVerified) {
        titleEl.innerHTML = `${chatName || 'Чат'} <svg class="tg-verify-icon" viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>`;
    }

    const avatarLetters = (chatName || 'Ч').substring(0, 2).toUpperCase();
    document.getElementById('room-header-avatar').innerText = avatarLetters;
    
    socket.emit('get_user_info', { user_id: chatId }, (userInfo) => {
        if (userInfo && userInfo.status === 'found') {
            document.getElementById('chat-room-status').innerText = userInfo.user.is_online ? '🟢 в сети' : 'был(а) недавно';
        }
    });

    document.getElementById('bottom-navigation').style.display = 'none';
    document.getElementById('chat-room').style.display = 'flex';
    
    const messagesContainer = document.getElementById('chat-messages');
    messagesContainer.innerHTML = '';

    // Приветственное сообщение для поддержки
    if (chatId === '0') {
        const welcomeMsg = {
            sender_id: '0',
            receiver_id: MY_ID,
            text: `👋 Добро пожаловать в DICEGRAM!\n\n🆔 Ваш ID: ${MY_ID}\n👤 Имя: ${tgUser.first_name} ${tgUser.last_name || ''}\n🏷️ Username: @${MY_USERNAME || 'не установлен'}\n\n📱 DICEGRAM — точная копия Telegram. Все данные сохраняются в базе данных.\n\n💬 Напишите нам, если у вас есть вопросы или предложения.`,
            timestamp: new Date().toISOString()
        };
        renderSingleMessage(welcomeMsg);
    }

    socket.emit('get_chat_history', { with_id: chatId }, (history) => {
        if (history && Array.isArray(history)) {
            history.forEach(msg => renderSingleMessage(msg));
            scrollToBottom();
        }
    });

    socket.emit('mark_as_read', { chat_id: chatId });
}

// Закрытие чата
function closeChat() {
    document.getElementById('chat-room').style.display = 'none';
    document.getElementById('bottom-navigation').style.display = 'flex';
    currentChatId = null;
}

// Обработка нового сообщения
function handleNewMessage(msg) {
    const chatPartner = msg.sender_id === MY_ID ? msg.receiver_id : msg.sender_id;

    if (chatPartner && chatPartner !== MY_ID) {
        if (!dynamicChats[chatPartner]) {
            socket.emit('get_user_info', { user_id: chatPartner }, (userInfo) => {
                if (userInfo && userInfo.status === 'found') {
                    dynamicChats[chatPartner] = {
                        first_name: userInfo.user.first_name || `User ${chatPartner}`,
                        username: userInfo.user.username || `@user${chatPartner}`
                    };
                    createChatRow(chatPartner, dynamicChats[chatPartner].first_name, dynamicChats[chatPartner].username);
                }
            });
        }

        if (msg.sender_id !== MY_ID && currentChatId !== chatPartner) {
            unreadCounts[chatPartner] = (unreadCounts[chatPartner] || 0) + 1;
            updateUnreadBadge(chatPartner, unreadCounts[chatPartner]);
        }
    }

    const previewEl = document.getElementById(`preview-${chatPartner}`);
    if (previewEl) previewEl.innerText = msg.text || '';

    if (currentChatId === chatPartner) {
        renderSingleMessage(msg);
        scrollToBottom();
        if (msg.sender_id !== MY_ID) {
            unreadCounts[chatPartner] = 0;
            updateUnreadBadge(chatPartner, 0);
        }
    }
}

// Отображение сообщения
function renderSingleMessage(msg) {
    if (!msg || !msg.text) return;
    
    const container = document.getElementById('chat-messages');
    
    const wrapper = document.createElement('div');
    wrapper.classList.add('message-wrapper');

    const msgEl = document.createElement('div');
    msgEl.classList.add('message');
    msgEl.dataset.messageId = msg.id || Date.now();

    const timeStr = getLocalTime(msg.timestamp);

    let ticksHtml = '';
    if (msg.sender_id === MY_ID) {
        wrapper.classList.add('sent');
        msgEl.classList.add('sent');
        ticksHtml = `<span class="status-ticks"><svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none"/><path d="M18 7l-1.41-1.41L10 12.17 7.41 9.59 6 11l4 4zm-4.24 0L12.35 5.59 6 11.94l1.41 1.41z"/></svg></span>`;
    } else {
        wrapper.classList.add('received');
        msgEl.classList.add('received');
    }

    msgEl.innerHTML = `
        <span>${formatMessageText(msg.text)}</span>
        <div class="message-meta">
            <span class="message-time">${timeStr}</span>
            ${ticksHtml}
        </div>
    `;

    // Долгое нажатие для меню
    let longPressTimer = null;
    msgEl.addEventListener('mousedown', () => {
        longPressTimer = setTimeout(() => {
            showMessageActions(msgEl.dataset.messageId);
        }, 500);
    });
    msgEl.addEventListener('mouseup', () => clearTimeout(longPressTimer));
    msgEl.addEventListener('mouseleave', () => clearTimeout(longPressTimer));
    
    msgEl.addEventListener('touchstart', () => {
        longPressTimer = setTimeout(() => {
            showMessageActions(msgEl.dataset.messageId);
        }, 500);
    });
    msgEl.addEventListener('touchend', () => clearTimeout(longPressTimer));
    msgEl.addEventListener('touchmove', () => clearTimeout(longPressTimer));

    wrapper.appendChild(msgEl);
    container.appendChild(wrapper);
}

// Поиск пользователей
function handleSearch(query) {
    const resultsContainer = document.getElementById('search-results');
    if (!query.trim()) {
        resultsContainer.style.display = 'none';
        resultsContainer.innerHTML = '';
        return;
    }

    if (!socket || !isConnected) {
        resultsContainer.style.display = 'block';
        resultsContainer.innerHTML = '<div style="padding:10px 14px;color:var(--tg-text-secondary);">Нет соединения с сервером</div>';
        return;
    }

    socket.emit('search_users', { query: query.trim() }, (results) => {
        resultsContainer.innerHTML = '';
        if (results && results.length > 0) {
            resultsContainer.style.display = 'block';
            results.forEach(user => {
                if (user.telegram_id === MY_ID) return;
                const item = document.createElement('div');
                item.className = 'search-result-item';
                const isBotFather = user.username === 'botfather';
                const verifiedIcon = isBotFather ? 
                    `<svg class="tg-verify-icon" viewBox="0 0 24 24" style="width:16px;height:16px;"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>` : '';
                const isVerified = user.telegram_id === CONFIG.CREATOR_ID || user.is_verified;
                const verifyBadge = isVerified ? `<span style="color:var(--tg-verified);font-size:12px;">✓</span>` : '';
                item.innerHTML = `
                    <div class="chat-avatar" style="width:36px;height:36px;font-size:12px;background:${isBotFather ? 'linear-gradient(135deg, #2a9d8f, #264653)' : 'linear-gradient(135deg, #5085b1, #366187)'}">${(user.first_name || 'U').substring(0,2).toUpperCase()}</div>
                    <div>
                        <div style="display:flex;align-items:center;gap:4px;font-weight:600;">${user.first_name || 'User'} ${verifiedIcon} ${verifyBadge}</div>
                        <div style="font-size:12px;color:var(--tg-text-secondary);">@${user.username || ''}</div>
                    </div>
                `;
                item.onclick = () => {
                    if (user.telegram_id === MY_ID) return;
                    if (!dynamicChats[user.telegram_id]) {
                        dynamicChats[user.telegram_id] = {
                            first_name: user.first_name || `User ${user.telegram_id}`,
                            username: user.username || ''
                        };
                        createChatRow(user.telegram_id, user.first_name || `User ${user.telegram_id}`, user.username || '');
                    }
                    openChat(user.telegram_id, user.first_name || `User ${user.telegram_id}`, user.username === 'botfather' || user.telegram_id === CONFIG.CREATOR_ID);
                    resultsContainer.style.display = 'none';
                    document.getElementById('global-search').value = '';
                };
                resultsContainer.appendChild(item);
            });
        } else {
            resultsContainer.style.display = 'block';
            resultsContainer.innerHTML = '<div style="padding:10px 14px;color:var(--tg-text-secondary);">Пользователи не найдены</div>';
        }
    });
}

// Отправка сообщения
function toggleSendButton(input) {
    const btn = document.getElementById('send-btn-icon');
    if (input && input.value && input.value.trim().length > 0) {
        btn.classList.add('active');
    } else {
        btn.classList.remove('active');
    }
}

function sendMessage() {
    const input = document.getElementById('message-field');
    const text = input.value.trim();
    if (!text || !currentChatId) return;

    if (!socket || !isConnected) {
        alert('Нет соединения с сервером');
        return;
    }

    if (currentChatId === 'botfather' || (dynamicChats[currentChatId] && dynamicChats[currentChatId].username === 'botfather')) {
        handleBotCommand(text);
        input.value = '';
        document.getElementById('send-btn-icon').classList.remove('active');
        return;
    }

    socket.emit('send_message', { receiver_id: currentChatId, text: text }, (response) => {
        if (response && response.status === 'ok') {
            renderSingleMessage(response.message);
            const previewEl = document.getElementById(`preview-${currentChatId}`);
            if (previewEl) previewEl.innerText = text;
            scrollToBottom();
        }
    });

    input.value = '';
    document.getElementById('send-btn-icon').classList.remove('active');
    input.focus();
}

// Обработка упоминаний
function handleMentionClick(username) {
    if (!socket || !isConnected) {
        alert('Нет соединения с сервером');
        return;
    }

    socket.emit('find_user', { username: username }, (response) => {
        if (response && response.status === 'found') {
            const user = response.user;
            if (user.telegram_id === MY_ID) return;
            if (!dynamicChats[user.telegram_id]) {
                dynamicChats[user.telegram_id] = {
                    first_name: user.first_name || `User ${user.telegram_id}`,
                    username: user.username || ''
                };
                createChatRow(user.telegram_id, user.first_name || `User ${user.telegram_id}`, user.username || '');
            }
            openChat(user.telegram_id, user.first_name || `User ${user.telegram_id}`, user.telegram_id === CONFIG.CREATOR_ID);
        } else {
            alert(`Пользователь ${username} не найден.`);
        }
    });
}