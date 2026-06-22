// ============ ЛОГИКА ЧАТОВ ============
let currentChatId = null;
let dynamicChats = {};
let unreadCounts = {};
let selectedMessageId = null;
let isInitialLoad = true;

// ============ РЕАКЦИИ ============
let currentMessageId = null;
const REACTIONS = ['👍', '❤️', '😂', '😢', '😡', '🔥', '🎉', '😎'];

// ============ ЗАГРУЗКА ЧАТОВ ============
function loadChatsAndMessages() {
    if (!socket || !isConnected) {
        console.log('⏳ Ожидание соединения...');
        setTimeout(loadChatsAndMessages, 1000);
        return;
    }

    console.log('📥 Загрузка чатов...');
    
    if (!dynamicChats[CONFIG.SUPPORT_ID]) {
        dynamicChats[CONFIG.SUPPORT_ID] = {
            first_name: 'DICEGRAM SUPPORT',
            username: 'dicegram_support'
        };
        createChatRow(CONFIG.SUPPORT_ID, 'DICEGRAM SUPPORT', 'dicegram_support', true);
    }
    
    if (!dynamicChats[CONFIG.BOTFATHER_ID]) {
        dynamicChats[CONFIG.BOTFATHER_ID] = {
            first_name: 'BotFather',
            username: 'botfather'
        };
        createChatRow(CONFIG.BOTFATHER_ID, 'BotFather', 'botfather', false);
    }

    socket.emit('get_all_chats', {}, (chats) => {
        console.log('📨 Получены чаты:', chats?.length || 0);
        
        const chatsList = document.getElementById('chats-list');
        chatsList.innerHTML = '';
        
        if (dynamicChats[CONFIG.SUPPORT_ID]) {
            createChatRow(CONFIG.SUPPORT_ID, 'DICEGRAM SUPPORT', 'dicegram_support', true);
        }
        if (dynamicChats[CONFIG.BOTFATHER_ID]) {
            createChatRow(CONFIG.BOTFATHER_ID, 'BotFather', 'botfather', false);
        }
        
        if (chats && Array.isArray(chats)) {
            chats.forEach(chat => {
                const partnerId = chat.chat_id || chat.partner_id;
                const chatType = chat.type || 'private';
                
                if (partnerId && partnerId !== MY_ID && 
                    partnerId !== CONFIG.SUPPORT_ID && 
                    partnerId !== CONFIG.BOTFATHER_ID) {
                    
                    if (!dynamicChats[partnerId]) {
                        dynamicChats[partnerId] = {
                            first_name: chat.name || chat.partner_name || `User ${partnerId}`,
                            username: chat.username || chat.partner_username || `@user${partnerId}`,
                            chat_type: chatType,
                            members_count: chat.members_count || 0,
                            role: chat.role || 'member',
                            invite_link: chat.invite_link || ''
                        };
                    }
                    
                    const isVerified = chat.is_verified || false;
                    createChatRow(partnerId, dynamicChats[partnerId].first_name, dynamicChats[partnerId].username, isVerified, chatType);
                    
                    if (chat.last_message) {
                        const previewEl = document.getElementById(`preview-${partnerId}`);
                        if (previewEl) {
                            let previewText = chat.last_message;
                            if (chatType === 'group') previewText = '👥 ' + previewText;
                            if (chatType === 'channel') previewText = '📢 ' + previewText;
                            previewEl.innerText = previewText;
                        }
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

// ============ СОЗДАНИЕ СТРОКИ ЧАТА ============
function createChatRow(tgId, firstName, username, isVerified = false, chatType = 'private') {
    if (!tgId) return;
    
    if (!dynamicChats[tgId]) {
        dynamicChats[tgId] = { 
            first_name: firstName || `User ${tgId}`, 
            username: username || '',
            chat_type: chatType
        };
    }
    
    const chatsList = document.getElementById('chats-list');
    if (document.getElementById(`chat-item-${tgId}`)) return;
    
    const isBotFather = username === 'botfather';
    const isSupport = tgId === CONFIG.SUPPORT_ID;
    const verified = isSupport || tgId === CONFIG.CREATOR_ID || isVerified;
    const verifiedIcon = verified ? 
        `<svg class="tg-verify-icon" viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>` : '';
    
    const displayName = firstName || `User ${tgId}`;
    let avatarBg = 'linear-gradient(135deg, #5085b1, #366187)';
    let typeIcon = '';
    
    if (isBotFather) {
        avatarBg = 'linear-gradient(135deg, #2a9d8f, #264653)';
    } else if (isSupport) {
        avatarBg = 'linear-gradient(135deg, #5288c1, #1a3a5c)';
    } else if (chatType === 'group') {
        avatarBg = 'linear-gradient(135deg, #e76f51, #f4a261)';
        typeIcon = '👥 ';
    } else if (chatType === 'channel') {
        avatarBg = 'linear-gradient(135deg, #2a9d8f, #264653)';
        typeIcon = '📢 ';
    }
    
    const rowHTML = `
        <div class="chat-item" id="chat-item-${tgId}" onclick="openChat('${tgId}', '${displayName.replace(/'/g, "\\'")}', ${verified})">
            <div class="chat-avatar" style="background: ${avatarBg}">
                ${displayName.substring(0,2).toUpperCase()}
                ${verified ? '<span class="verified-badge">✅</span>' : ''}
                ${chatType === 'group' ? '<span style="position:absolute;bottom:-2px;left:-2px;font-size:10px;">👥</span>' : ''}
                ${chatType === 'channel' ? '<span style="position:absolute;bottom:-2px;left:-2px;font-size:10px;">📢</span>' : ''}
            </div>
            <div class="chat-details">
                <div class="chat-title-row">
                    <div class="chat-name">${typeIcon}${displayName} ${verifiedIcon}</div>
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

// ============ ОБНОВЛЕНИЕ СЧЕТЧИКА ============
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

// ============ ОТКРЫТИЕ ЧАТА ============
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
    
    // Проверяем тип чата
    const chatInfo = dynamicChats[chatId];
    if (chatInfo) {
        if (chatInfo.chat_type === 'group') {
            titleEl.innerText = '👥 ' + (chatName || 'Группа');
        } else if (chatInfo.chat_type === 'channel') {
            titleEl.innerText = '📢 ' + (chatName || 'Канал');
        }
    }
    
    socket.emit('get_user_info', { user_id: chatId }, (userInfo) => {
        if (userInfo && userInfo.status === 'found') {
            const isVerifiedUser = userInfo.user.is_verified || chatId === CONFIG.SUPPORT_ID || chatId === CONFIG.CREATOR_ID;
            if (isVerifiedUser) {
                titleEl.innerHTML = `${titleEl.innerText} <span class="verified-check">✅</span>`;
            }
            document.getElementById('chat-room-status').innerText = userInfo.user.is_online ? '🟢 в сети' : 'был(а) недавно';
        } else {
            // Если это группа или канал
            if (chatInfo && (chatInfo.chat_type === 'group' || chatInfo.chat_type === 'channel')) {
                document.getElementById('chat-room-status').innerText = `${chatInfo.members_count || 0} участников`;
            }
        }
    });

    document.getElementById('bottom-navigation').style.display = 'none';
    document.getElementById('chat-room').style.display = 'flex';
    
    const messagesContainer = document.getElementById('chat-messages');
    messagesContainer.innerHTML = '';

    if (chatId === CONFIG.SUPPORT_ID) {
        const welcomeMsg = {
            id: Date.now(),
            sender_id: CONFIG.SUPPORT_ID,
            receiver_id: MY_ID,
            text: `👋 Добро пожаловать в DICEGRAM!\n\n🆔 Ваш ID: ${MY_ID}\n👤 Имя: ${tgUser.first_name} ${tgUser.last_name || ''}\n🏷️ Username: @${MY_USERNAME || 'не установлен'}\n\n📱 DICEGRAM — точная копия Telegram. Все данные сохраняются в базе данных.\n\n💬 Напишите нам, если у вас есть вопросы или предложения.`,
            timestamp: new Date().toISOString(),
            is_read: true
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
    
    // Проверяем права в канале
    if (chatInfo && chatInfo.chat_type === 'channel') {
        checkChannelPermission(chatId);
    }
}

// ============ ПРОВЕРКА ПРАВ В КАНАЛЕ ============
function checkChannelPermission(chatId) {
    socket.emit('check_channel_permission', { chat_id: chatId }, (response) => {
        if (response && response.status === 'ok') {
            const inputArea = document.querySelector('.chat-input-area');
            const input = document.getElementById('message-field');
            const sendBtn = document.getElementById('send-btn-icon');
            
            if (response.chat_type === 'channel' && !response.can_write) {
                input.disabled = true;
                input.placeholder = '📢 Канал доступен только для чтения';
                sendBtn.style.opacity = '0.3';
                sendBtn.style.cursor = 'not-allowed';
            } else {
                input.disabled = false;
                input.placeholder = 'Сообщение...';
                sendBtn.style.opacity = '1';
                sendBtn.style.cursor = 'pointer';
            }
        }
    });
}

// ============ ЗАКРЫТИЕ ЧАТА ============
function closeChat() {
    document.getElementById('chat-room').style.display = 'none';
    document.getElementById('bottom-navigation').style.display = 'flex';
    currentChatId = null;
    
    // Восстанавливаем поле ввода
    const input = document.getElementById('message-field');
    const sendBtn = document.getElementById('send-btn-icon');
    input.disabled = false;
    input.placeholder = 'Сообщение...';
    sendBtn.style.opacity = '1';
    sendBtn.style.cursor = 'pointer';
}

// ============ ОБРАБОТКА НОВОГО СООБЩЕНИЯ ============
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
                    const isVerified = userInfo.user.is_verified || chatPartner === CONFIG.SUPPORT_ID;
                    createChatRow(chatPartner, dynamicChats[chatPartner].first_name, dynamicChats[chatPartner].username, isVerified);
                }
            });
        }

        if (msg.sender_id !== MY_ID && currentChatId !== chatPartner) {
            unreadCounts[chatPartner] = (unreadCounts[chatPartner] || 0) + 1;
            updateUnreadBadge(chatPartner, unreadCounts[chatPartner]);
        }
    }

    const previewEl = document.getElementById(`preview-${chatPartner}`);
    if (previewEl) {
        let previewText = msg.text || '';
        const chatInfo = dynamicChats[chatPartner];
        if (chatInfo) {
            if (chatInfo.chat_type === 'group') previewText = '👥 ' + previewText;
            if (chatInfo.chat_type === 'channel') previewText = '📢 ' + previewText;
        }
        previewEl.innerText = previewText;
    }

    if (currentChatId === chatPartner) {
        renderSingleMessage(msg);
        scrollToBottom();
        if (msg.sender_id !== MY_ID) {
            unreadCounts[chatPartner] = 0;
            updateUnreadBadge(chatPartner, 0);
        }
    }
}

// ============ ОТОБРАЖЕНИЕ СООБЩЕНИЯ ============
function renderSingleMessage(msg) {
    if (!msg || !msg.text) return;
    
    const container = document.getElementById('chat-messages');
    
    const wrapper = document.createElement('div');
    wrapper.classList.add('message-wrapper');

    const msgEl = document.createElement('div');
    msgEl.classList.add('message');
    msgEl.dataset.messageId = msg.id || Date.now();

    const timeStr = getLocalTime(msg.timestamp);

    // Проверяем системное сообщение
    if (msg.sender_id === 'system') {
        msgEl.classList.add('system-message');
        msgEl.innerHTML = `
            <div class="system-message-content">
                <span>${formatMessageText(msg.text)}</span>
                <div class="message-meta">
                    <span class="message-time">${timeStr}</span>
                </div>
            </div>
        `;
        wrapper.classList.add('system');
        wrapper.appendChild(msgEl);
        container.appendChild(wrapper);
        return;
    }

    let ticksHtml = '';
    if (msg.sender_id === MY_ID) {
        wrapper.classList.add('sent');
        msgEl.classList.add('sent');
        
        if (msg.is_read) {
            ticksHtml = `<span class="status-ticks read"><svg viewBox="0 0 24 24"><path d="M18 7l-1.41-1.41L10 12.17 7.41 9.59 6 11l4 4zm-4.24 0L12.35 5.59 6 11.94l1.41 1.41z"/><path d="M0 0h24v24H0z" fill="none"/></svg></span>`;
        } else if (msg.delivered) {
            ticksHtml = `<span class="status-ticks delivered"><svg viewBox="0 0 24 24"><path d="M18 7l-1.41-1.41L10 12.17 7.41 9.59 6 11l4 4z"/><path d="M0 0h24v24H0z" fill="none"/></svg></span>`;
        } else {
            ticksHtml = `<span class="status-ticks sent"><svg viewBox="0 0 24 24"><path d="M18 7l-1.41-1.41L10 12.17 7.41 9.59 6 11l4 4z"/><path d="M0 0h24v24H0z" fill="none"/></svg></span>`;
        }
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
    
    if (msg.id) {
        setTimeout(() => updateReactionDisplay(msg.id), 200);
    }
}

// ============ ПОИСК ПОЛЬЗОВАТЕЛЕЙ ============
function handleSearch(query) {
    const resultsContainer = document.getElementById('search-results');
    if (!query.trim()) {
        resultsContainer.style.display = 'none';
        resultsContainer.innerHTML = '';
        return;
    }

    // Проверяем, может это инвайт-ссылка
    if (query.includes('dicegram.me/')) {
        const link = query.replace('https://', '').replace('dicegram.me/', '').trim();
        if (link) {
            joinByInvite(link);
            document.getElementById('global-search').value = '';
            resultsContainer.style.display = 'none';
            return;
        }
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
                const isVerified = user.telegram_id === CONFIG.CREATOR_ID || user.is_verified || user.telegram_id === CONFIG.SUPPORT_ID;
                const verifyBadge = isVerified ? `<span class="verified-check">✅</span>` : '';
                item.innerHTML = `
                    <div class="chat-avatar" style="width:36px;height:36px;font-size:12px;background:${isBotFather ? 'linear-gradient(135deg, #2a9d8f, #264653)' : 'linear-gradient(135deg, #5085b1, #366187)'}">
                        ${(user.first_name || 'U').substring(0,2).toUpperCase()}
                        ${isVerified ? '<span class="verified-badge" style="font-size:10px;">✅</span>' : ''}
                    </div>
                    <div>
                        <div style="display:flex;align-items:center;gap:4px;font-weight:600;">${user.first_name || 'User'} ${verifyBadge}</div>
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
                        createChatRow(user.telegram_id, user.first_name || `User ${user.telegram_id}`, user.username || '', isVerified);
                    }
                    openChat(user.telegram_id, user.first_name || `User ${user.telegram_id}`, isVerified);
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

// ============ ОТПРАВКА СООБЩЕНИЯ ============
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

    // Проверка на канал
    const chatInfo = dynamicChats[currentChatId];
    if (chatInfo && chatInfo.chat_type === 'channel') {
        // Проверяем права через сервер
        socket.emit('check_channel_permission', { chat_id: currentChatId }, (response) => {
            if (response && response.status === 'ok') {
                if (!response.can_write) {
                    alert('📢 Только владелец канала может отправлять сообщения');
                    return;
                }
                // Владелец может писать
                sendMessageToServer(text);
            } else {
                alert('Ошибка проверки прав');
            }
        });
        return;
    }

    // Обычный чат или группа
    if (currentChatId === CONFIG.BOTFATHER_ID || (dynamicChats[currentChatId] && dynamicChats[currentChatId].username === 'botfather')) {
        handleBotCommand(text);
        input.value = '';
        document.getElementById('send-btn-icon').classList.remove('active');
        return;
    }

    sendMessageToServer(text);
}

function sendMessageToServer(text) {
    const input = document.getElementById('message-field');
    
    const tempId = Date.now();
    const tempMsg = {
        id: tempId,
        sender_id: MY_ID,
        receiver_id: currentChatId,
        text: text,
        timestamp: new Date().toISOString(),
        is_read: false,
        delivered: false
    };
    renderSingleMessage(tempMsg);
    scrollToBottom();

    socket.emit('send_message', { receiver_id: currentChatId, text: text }, (response) => {
        if (response && response.status === 'ok') {
            const msgEl = document.querySelector(`[data-message-id="${tempId}"]`);
            if (msgEl) {
                const ticks = msgEl.querySelector('.status-ticks');
                if (ticks) {
                    ticks.className = 'status-ticks delivered';
                    ticks.innerHTML = `<svg viewBox="0 0 24 24"><path d="M18 7l-1.41-1.41L10 12.17 7.41 9.59 6 11l4 4z"/><path d="M0 0h24v24H0z" fill="none"/></svg>`;
                }
                msgEl.dataset.messageId = response.message.id;
            }
            const previewEl = document.getElementById(`preview-${currentChatId}`);
            if (previewEl) {
                let previewText = text;
                const chatInfo = dynamicChats[currentChatId];
                if (chatInfo) {
                    if (chatInfo.chat_type === 'group') previewText = '👥 ' + previewText;
                    if (chatInfo.chat_type === 'channel') previewText = '📢 ' + previewText;
                }
                previewEl.innerText = previewText;
            }
        }
    });

    input.value = '';
    document.getElementById('send-btn-icon').classList.remove('active');
    input.focus();
}

// ============ ОБРАБОТКА КОМАНД BOTFATHER ============
function handleBotCommand(text) {
    const botResponse = emulateBotFather(text);
    
    const userMsg = {
        id: Date.now(),
        sender_id: MY_ID,
        receiver_id: CONFIG.BOTFATHER_ID,
        text: text,
        timestamp: new Date().toISOString(),
        is_read: true
    };
    renderSingleMessage(userMsg);
    
    setTimeout(() => {
        const botMsg = {
            id: Date.now() + 1,
            sender_id: CONFIG.BOTFATHER_ID,
            receiver_id: MY_ID,
            text: botResponse,
            timestamp: new Date().toISOString(),
            is_read: true
        };
        renderSingleMessage(botMsg);
        scrollToBottom();
    }, 500);
}

function emulateBotFather(text) {
    const lower = text.toLowerCase().trim();
    
    if (lower === '/start') {
        return `I can help you create and manage Telegram bots. If you're new to the Bot API, please see the manual.\n\nYou can control me by sending these commands:\n\n/newbot - create a new bot\n/mybots - edit your bots`;
    }
    
    if (lower === '/newbot') {
        return `Alright, a new bot. How are we going to call it? Please choose a name for your bot.`;
    }
    
    if (!window.botCreationStep) {
        window.botCreationStep = 'name';
        window.botName = text;
        return `Good. Now let's choose a username for your bot. It must end in \`bot\`. Like this, for example: TetrisBot or tetris_bot.`;
    } else if (window.botCreationStep === 'name') {
        window.botName = text;
        window.botCreationStep = 'username';
        return `Good. Now let's choose a username for your bot. It must end in \`bot\`. Like this, for example: TetrisBot or tetris_bot.`;
    } else if (window.botCreationStep === 'username') {
        const username = text.trim();
        if (!username.endsWith('bot')) {
            return `Sorry, the username must end with 'bot'. Please try again.`;
        }
        
        if (window.createdBots && window.createdBots.includes(username)) {
            return `Sorry, this username is invalid.`;
        }
        
        if (!window.createdBots) window.createdBots = [];
        window.createdBots.push(username);
        window.botCreationStep = null;
        
        const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        return `Done! Congratulations on your new bot. You will find it at d.me/${username}. You can now add a description, about section and profile picture for your bot, see /help for a list of commands. By the way, when you've finished creating your cool bot, ping our Bot Support if you want a better username for it. Just make sure the bot is fully operational before you do this.\n\nUse this token to access the HTTP API:\n${token}\n\nKeep your token secure and store it safely, it can be used by anyone to control your bot.`;
    }
    
    return `I don't understand that command. Please use /start, /newbot, or /mybots.`;
}

// ============ ОБРАБОТКА УПОМИНАНИЙ ============
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
                const isVerified = user.is_verified || user.telegram_id === CONFIG.SUPPORT_ID;
                createChatRow(user.telegram_id, user.first_name || `User ${user.telegram_id}`, user.username || '', isVerified);
            }
            openChat(user.telegram_id, user.first_name || `User ${user.telegram_id}`, user.telegram_id === CONFIG.CREATOR_ID || user.is_verified);
        } else {
            alert(`Пользователь ${username} не найден.`);
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
                loadChatsAndMessages();
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

// ============ ДЕЙСТВИЯ С СООБЩЕНИЯМИ ============
function showMessageActions(messageId) {
    const msgEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!msgEl) return;
    
    const wrapper = msgEl.closest('.message-wrapper');
    const isSent = wrapper.classList.contains('sent');
    
    const actions = document.getElementById('message-actions');
    
    if (!isSent) {
        actions.innerHTML = `
            <button class="message-action-btn" onclick="replyToMessage()">↩ Ответить</button>
            <button class="message-action-btn" onclick="forwardMessage()">📤 Переслать</button>
            <button class="message-action-btn" onclick="copyMessage()">📋 Копировать</button>
            <button class="message-action-btn" onclick="showReactionPicker('${messageId}')">😊 Реакция</button>
        `;
    } else {
        actions.innerHTML = `
            <button class="message-action-btn" onclick="replyToMessage()">↩ Ответить</button>
            <button class="message-action-btn" onclick="forwardMessage()">📤 Переслать</button>
            <button class="message-action-btn" onclick="copyMessage()">📋 Копировать</button>
            <button class="message-action-btn" onclick="showReactionPicker('${messageId}')">😊 Реакция</button>
            <button class="message-action-btn" onclick="editMessage()">✏️ Изменить</button>
            <button class="message-action-btn danger" onclick="deleteMessage()">🗑 Удалить</button>
            <button class="message-action-btn" onclick="pinMessage()">📌 Закрепить</button>
        `;
    }
    
    actions.classList.toggle('active');
    selectedMessageId = messageId;
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
                    const textSpan = msgEl.querySelector('span');
                    if (textSpan) {
                        textSpan.innerHTML = formatMessageText(newText.trim());
                    }
                }
                document.getElementById('message-actions').classList.remove('active');
            }
        });
    }
}

function deleteMessage() {
    if (confirm('🗑 Удалить сообщение?')) {
        socket.emit('delete_message', { message_id: selectedMessageId }, (response) => {
            if (response && response.status === 'ok') {
                const msgEl = document.querySelector(`[data-message-id="${selectedMessageId}"]`);
                if (msgEl) {
                    msgEl.closest('.message-wrapper').remove();
                }
                document.getElementById('message-actions').classList.remove('active');
            }
        });
    }
}

function pinMessage() {
    socket.emit('pin_message', { message_id: selectedMessageId }, (response) => {
        if (response && response.status === 'ok') {
            alert('📌 Сообщение закреплено');
        }
    });
    document.getElementById('message-actions').classList.remove('active');
}

// ============ РЕАКЦИИ ============
function showReactionPicker(messageId) {
    currentMessageId = messageId;
    let picker = document.getElementById('reaction-picker');
    
    if (!picker) {
        picker = document.createElement('div');
        picker.id = 'reaction-picker';
        picker.className = 'reaction-picker';
        picker.innerHTML = REACTIONS.map(r => 
            `<span class="reaction-emoji" onclick="addReaction('${r}')">${r}</span>`
        ).join('');
        document.body.appendChild(picker);
    }
    
    const rect = document.querySelector(`[data-message-id="${messageId}"]`)?.getBoundingClientRect();
    if (rect) {
        picker.style.top = `${rect.top - 50}px`;
        picker.style.left = `${rect.left + rect.width / 2 - 140}px`;
        picker.classList.toggle('active');
    }
    
    document.getElementById('message-actions')?.classList.remove('active');
}

function addReaction(emoji) {
    if (!currentMessageId || !socket || !isConnected) return;
    
    socket.emit('add_reaction', { 
        message_id: currentMessageId, 
        reaction: emoji 
    }, (response) => {
        if (response && response.status === 'ok') {
            updateReactionDisplay(currentMessageId);
        }
    });
    
    document.getElementById('reaction-picker')?.classList.remove('active');
}

function updateReactionDisplay(messageId) {
    socket.emit('get_reactions', { message_id: messageId }, (reactions) => {
        const msgEl = document.querySelector(`[data-message-id="${messageId}"]`);
        if (!msgEl) return;
        
        const oldReactions = msgEl.querySelector('.reactions');
        if (oldReactions) oldReactions.remove();
        
        if (reactions && reactions.length > 0) {
            const container = document.createElement('div');
            container.className = 'reactions';
            
            const grouped = {};
            reactions.forEach(r => {
                if (!grouped[r.reaction]) grouped[r.reaction] = [];
                grouped[r.reaction].push(r.user_id);
            });
            
            Object.entries(grouped).forEach(([emoji, users]) => {
                const span = document.createElement('span');
                span.className = 'reaction-item';
                span.innerText = `${emoji} ${users.length}`;
                span.title = users.map(id => `User ${id}`).join(', ');
                container.appendChild(span);
            });
            
            msgEl.appendChild(container);
        }
    });
}

// ============ СОБЫТИЯ СОКЕТА ============
if (socket) {
    socket.on('message_read', (data) => {
        const msgEl = document.querySelector(`[data-message-id="${data.message_id}"]`);
        if (msgEl) {
            const ticks = msgEl.querySelector('.status-ticks');
            if (ticks) {
                ticks.className = 'status-ticks read';
                ticks.innerHTML = `<svg viewBox="0 0 24 24"><path d="M18 7l-1.41-1.41L10 12.17 7.41 9.59 6 11l4 4zm-4.24 0L12.35 5.59 6 11.94l1.41 1.41z"/><path d="M0 0h24v24H0z" fill="none"/></svg>`;
            }
        }
    });

    socket.on('reaction_updated', (data) => {
        updateReactionDisplay(data.message_id);
    });
}

console.log('✅ Chat module loaded');
