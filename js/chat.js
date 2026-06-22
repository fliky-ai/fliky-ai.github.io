// ============ ЛОГИКА ЧАТОВ ============
let currentChatId = null;
if (typeof dynamicChats === 'undefined') window.dynamicChats = {};
let unreadCounts = {};
let selectedMessageId = null;
let isInitialLoad = true;

// Красивый синий нативный SVG для галочки верификации в списках
const cVerifiedIconSvg = `<span class="verified-check" style="display: inline-flex; align-self: center; margin-left: 5px; vertical-align: middle;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#2f8cc9"/><path d="M9 12l2 2 4-4" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></span>`;

// ============ REACTION MANAGEMENT ============
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
        if (!chatsList) return;
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
    if (!chatsList || document.getElementById(`chat-item-${tgId}`)) return;
    
    const isBotFather = username === 'botfather';
    const isSupport = tgId === CONFIG.SUPPORT_ID;
    const verified = isSupport || tgId === CONFIG.CREATOR_ID || isVerified;
    
    const displayName = (firstName || `User ${tgId}`).replace(/✅/g, '').trim();
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
                ${chatType === 'group' ? '<span style="position:absolute;bottom:-2px;left:-2px;font-size:10px;">👥</span>' : ''}
                ${chatType === 'channel' ? '<span style="position:absolute;bottom:-2px;left:-2px;font-size:10px;">📢</span>' : ''}
            </div>
            <div class="chat-details">
                <div class="chat-title-row">
                    <div class="chat-name" style="display:flex; align-items:center; gap:2px;">
                        ${typeIcon}${displayName}${verified ? cVerifiedIconSvg : ''}
                    </div>
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
        if (!socket || !isConnected) alert('Нет соединения с сервером');
        return;
    }

    currentChatId = chatId;
    unreadCounts[chatId] = 0;
    updateUnreadBadge(chatId, 0);
    
    const titleEl = document.getElementById('chat-room-title');
    let cleanName = (chatName || 'Чат').replace(/✅/g, '').trim();
    
    const chatInfo = dynamicChats[chatId];
    if (chatInfo) {
        if (chatInfo.chat_type === 'group') {
            cleanName = '👥 ' + cleanName;
        } else if (chatInfo.chat_type === 'channel') {
            cleanName = '📢 ' + cleanName;
        }
    }
    
    if (titleEl) titleEl.innerHTML = `${cleanName}${isVerified ? cVerifiedIconSvg : ''}`;
    
    socket.emit('get_user_info', { user_id: chatId }, (userInfo) => {
        if (userInfo && userInfo.status === 'found') {
            const isVerifiedUser = userInfo.user.is_verified || chatId === CONFIG.SUPPORT_ID || chatId === CONFIG.CREATOR_ID;
            if (titleEl) titleEl.innerHTML = `${cleanName}${isVerifiedUser ? cVerifiedIconSvg : ''}`;
            const statusRoom = document.getElementById('chat-room-status');
            if (statusRoom) statusRoom.innerText = userInfo.user.is_online ? '🟢 в сети' : 'был(а) недавно';
        } else {
            if (chatInfo && (chatInfo.chat_type === 'group' || chatInfo.chat_type === 'channel')) {
                const statusRoom = document.getElementById('chat-room-status');
                if (statusRoom) statusRoom.innerText = `${chatInfo.members_count || 0} участников`;
            }
        }
    });

    const bNav = document.getElementById('bottom-navigation');
    if (bNav) bNav.style.display = 'none';
    const cRoom = document.getElementById('chat-room');
    if (cRoom) cRoom.style.display = 'flex';
    
    const messagesContainer = document.getElementById('chat-messages');
    if (messagesContainer) messagesContainer.innerHTML = '';

    if (chatId === CONFIG.SUPPORT_ID && typeof tgUser !== 'undefined') {
        const welcomeMsg = {
            id: Date.now(),
            sender_id: CONFIG.SUPPORT_ID,
            receiver_id: MY_ID,
            text: `👋 Добро пожаловать в DICEGRAM!\n\n🆔 Ваш ID: ${MY_ID}\n👤 Имя: ${tgUser.first_name} ${tgUser.last_name || ''}\n🏷️ Username: @${(typeof MY_USERNAME !== 'undefined' ? MY_USERNAME : '') || 'не установлен'}\n\n📱 DICEGRAM — копия Telegram. Все данные сохраняются.\n\n💬 Напишите нам, если возникнут вопросы.`,
            timestamp: new Date().toISOString(),
            is_read: true
        };
        renderSingleMessage(welcomeMsg);
    }

    socket.emit('get_chat_history', { with_id: chatId }, (history) => {
        if (history && Array.isArray(history)) {
            history.forEach(msg => renderSingleMessage(msg));
            if (typeof scrollToBottom === 'function') scrollToBottom();
        }
    });

    socket.emit('mark_as_read', { chat_id: chatId });
    if (chatInfo && chatInfo.chat_type === 'channel') {
        checkChannelPermission(chatId);
    }
}

function checkChannelPermission(chatId) {
    socket.emit('check_channel_permission', { chat_id: chatId }, (response) => {
        if (response && response.status === 'ok') {
            const input = document.getElementById('message-field');
            const sendBtn = document.getElementById('send-btn-icon');
            if (!input || !sendBtn) return;
            
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

function closeChat() {
    const cRoom = document.getElementById('chat-room');
    if (cRoom) cRoom.style.display = 'none';
    const bNav = document.getElementById('bottom-navigation');
    if (bNav) bNav.style.display = 'flex';
    currentChatId = null;
    
    const input = document.getElementById('message-field');
    const sendBtn = document.getElementById('send-btn-icon');
    if (input && sendBtn) {
        input.disabled = false;
        input.placeholder = 'Сообщение...';
        sendBtn.style.opacity = '1';
        sendBtn.style.cursor = 'pointer';
    }
}

function handleNewMessage(msg) {
    if (!msg || !msg.text) return;
    const chatPartner = msg.sender_id === MY_ID ? msg.receiver_id : msg.sender_id;
    
    if (msg.sender_id === 'system') {
        renderSingleMessage(msg);
        if (typeof scrollToBottom === 'function') scrollToBottom();
        return;
    }

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
                } else {
                    socket.emit('get_group_info', { chat_id: chatPartner }, (groupInfo) => {
                        if (groupInfo && groupInfo.status === 'found') {
                            const chat = groupInfo.chat;
                            dynamicChats[chatPartner] = {
                                first_name: chat.name || 'Чат',
                                username: '',
                                chat_type: chat.type,
                                invite_link: chat.invite_link
                            };
                            createChatRow(chatPartner, chat.name || 'Чат', '', chat.type === 'channel', chat.type);
                        }
                    });
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
        if (typeof scrollToBottom === 'function') scrollToBottom();
        if (msg.sender_id !== MY_ID) {
            unreadCounts[chatPartner] = 0;
            updateUnreadBadge(chatPartner, 0);
        }
    }
}

function renderSingleMessage(msg) {
    if (!msg || !msg.text) return;
    const container = document.getElementById('chat-messages');
    if (!container) return;
    
    const wrapper = document.createElement('div');
    wrapper.classList.add('message-wrapper');

    const msgEl = document.createElement('div');
    msgEl.classList.add('message');
    msgEl.dataset.messageId = msg.id || Date.now();

    const timeStr = (typeof getLocalTime === 'function') ? getLocalTime(msg.timestamp) : '';
    const formattedText = (typeof formatMessageText === 'function') ? formatMessageText(msg.text) : msg.text;

    if (msg.sender_id === 'system') {
        msgEl.classList.add('system-message');
        msgEl.innerHTML = `
            <div class="system-message-content">
                <span>${formattedText}</span>
                <div class="message-meta"><span class="message-time">${timeStr}</span></div>
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
        } else {
            ticksHtml = `<span class="status-ticks delivered"><svg viewBox="0 0 24 24"><path d="M18 7l-1.41-1.41L10 12.17 7.41 9.59 6 11l4 4z"/><path d="M0 0h24v24H0z" fill="none"/></svg></span>`;
        }
    } else {
        wrapper.classList.add('received');
        msgEl.classList.add('received');
    }

    msgEl.innerHTML = `
        <span>${formattedText}</span>
        <div class="message-meta">
            <span class="message-time">${timeStr}</span>
            ${ticksHtml}
        </div>
    `;

    let longPressTimer = null;
    const startPress = () => { longPressTimer = setTimeout(() => { showMessageActions(msgEl.dataset.messageId); }, 500); };
    const clearPress = () => { clearTimeout(longPressTimer); };

    msgEl.addEventListener('mousedown', startPress);
    msgEl.addEventListener('mouseup', clearPress);
    msgEl.addEventListener('mouseleave', clearPress);
    msgEl.addEventListener('touchstart', startPress);
    msgEl.addEventListener('touchend', clearPress);

    wrapper.appendChild(msgEl);
    container.appendChild(wrapper);
    
    if (msg.id) {
        setTimeout(() => updateReactionDisplay(msg.id), 200);
    }
}

function handleSearch(query) {
    const resultsContainer = document.getElementById('search-results');
    if (!resultsContainer) return;
    if (!query.trim()) {
        resultsContainer.style.display = 'none';
        resultsContainer.innerHTML = '';
        return;
    }

    const inviteMatch = query.match(/dicegram\.me\/([a-zA-Z0-9_]+)/);
    if (inviteMatch) {
        const code = inviteMatch[1];
        if (window.joinByInvite) {
            window.joinByInvite(code);
            const gSearch = document.getElementById('global-search');
            if (gSearch) gSearch.value = '';
            resultsContainer.style.display = 'none';
            return;
        }
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
                
                item.innerHTML = `
                    <div class="chat-avatar" style="width:36px;height:36px;font-size:12px;background:${isBotFather ? 'linear-gradient(135deg, #2a9d8f, #264653)' : 'linear-gradient(135deg, #5085b1, #366187)'}">
                        ${(user.first_name || 'U').substring(0,2).toUpperCase()}
                    </div>
                    <div>
                        <div style="display:flex;align-items:center;gap:2px;font-weight:600;">
                            ${user.first_name || 'User'}${isVerified ? cVerifiedIconSvg : ''}
                        </div>
                        <div style="font-size:12px;color:var(--tg-text-secondary);">@${user.username || ''}</div>
                    </div>
                `;
                item.onclick = () => {
                    if (!dynamicChats[user.telegram_id]) {
                        dynamicChats[user.telegram_id] = { first_name: user.first_name || `User ${user.telegram_id}`, username: user.username || '' };
                        createChatRow(user.telegram_id, user.first_name || `User ${user.telegram_id}`, user.username || '', isVerified);
                    }
                    openChat(user.telegram_id, user.first_name || `User ${user.telegram_id}`, isVerified);
                    resultsContainer.style.display = 'none';
                    const gSearch = document.getElementById('global-search');
                    if (gSearch) gSearch.value = '';
                };
                resultsContainer.appendChild(item);
            });
        } else {
            resultsContainer.style.display = 'block';
            resultsContainer.innerHTML = '<div style="padding:10px 14px;color:var(--tg-text-secondary);">Пользователи не найдены</div>';
        }
    });
}

function toggleSendButton(input) {
    const btn = document.getElementById('send-btn-icon');
    if (!btn) return;
    if (input && input.value && input.value.trim().length > 0) {
        btn.classList.add('active');
    } else {
        btn.classList.remove('active');
    }
}

function sendMessage() {
    const input = document.getElementById('message-field');
    if (!input) return;
    const text = input.value.trim();
    if (!text || !currentChatId) return;

    const chatInfo = dynamicChats[currentChatId];
    if (chatInfo && chatInfo.chat_type === 'channel') {
        socket.emit('check_channel_permission', { chat_id: currentChatId }, (response) => {
            if (response && response.status === 'ok' && response.can_write) {
                sendMessageToServer(text);
            } else {
                alert('📢 Только владелец канала может писать сюда');
            }
        });
        return;
    }

    if (currentChatId === CONFIG.BOTFATHER_ID || (chatInfo && chatInfo.username === 'botfather')) {
        handleBotCommand(text);
        input.value = '';
        const sBtn = document.getElementById('send-btn-icon');
        if (sBtn) sBtn.classList.remove('active');
        return;
    }

    sendMessageToServer(text);
}

function sendMessageToServer(text) {
    const input = document.getElementById('message-field');
    const tempId = Date.now();
    renderSingleMessage({ id: tempId, sender_id: MY_ID, receiver_id: currentChatId, text: text, timestamp: new Date().toISOString(), is_read: false });
    if (typeof scrollToBottom === 'function') scrollToBottom();

    socket.emit('send_message', { receiver_id: currentChatId, text: text }, (response) => {
        if (response && response.status === 'ok') {
            const msgEl = document.querySelector(`[data-message-id="${tempId}"]`);
            if (msgEl) msgEl.dataset.messageId = response.message.id;
            const previewEl = document.getElementById(`preview-${currentChatId}`);
            if (previewEl) {
                let pText = text;
                if (dynamicChats[currentChatId]?.chat_type === 'group') pText = '👥 ' + pText;
                if (dynamicChats[currentChatId]?.chat_type === 'channel') pText = '📢 ' + pText;
                previewEl.innerText = pText;
            }
        }
    });

    if (input) {
        input.value = '';
        const sBtn = document.getElementById('send-btn-icon');
        if (sBtn) sBtn.classList.remove('active');
        input.focus();
    }
}

function handleBotCommand(text) {
    const botResponse = emulateBotFather(text);
    renderSingleMessage({ id: Date.now(), sender_id: MY_ID, receiver_id: CONFIG.BOTFATHER_ID, text: text, timestamp: new Date().toISOString(), is_read: true });
    
    setTimeout(() => {
        renderSingleMessage({ id: Date.now() + 1, sender_id: CONFIG.BOTFATHER_ID, receiver_id: MY_ID, text: botResponse, timestamp: new Date().toISOString(), is_read: true });
        if (typeof scrollToBottom === 'function') scrollToBottom();
    }, 500);
}

function emulateBotFather(text) {
    const lower = text.toLowerCase().trim();
    if (lower === '/start') return `I can help you create and manage Telegram bots.\n\nCommands:\n/newbot - create a new bot\n/mybots - edit your bots`;
    if (lower === '/newbot') { window.botCreationStep = 'name'; return `Alright, a new bot. How are we going to call it? Please choose a name.`; }
    
    if (window.botCreationStep === 'name') {
        window.botName = text; window.botCreationStep = 'username';
        return `Good. Now let's choose a username for your bot. It must end in 'bot'.`;
    } else if (window.botCreationStep === 'username') {
        if (!text.trim().endsWith('bot')) return `Sorry, the username must end with 'bot'. Try again.`;
        window.botCreationStep = null;
        return `Done! Use this token to access the HTTP API:\n${Math.random().toString(36).substring(2, 15)}`;
    }
    return `I don't understand that command.`;
}

function showMessageActions(messageId) {
    const msgEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!msgEl) return;
    const isSent = msgEl.closest('.message-wrapper')?.classList.contains('sent');
    const actions = document.getElementById('message-actions');
    if (!actions) return;
    
    let btns = `
        <button class="message-action-btn" onclick="replyToMessage()">↩ Ответить</button>
        <button class="message-action-btn" onclick="forwardMessage()">📤 Переслать</button>
        <button class="message-action-btn" onclick="copyMessage()">📋 Копировать</button>
        <button class="message-action-btn" onclick="showReactionPicker('${messageId}')">😊 Реакция</button>
    `;
    if (isSent) {
        btns += `
            <button class="message-action-btn" onclick="editMessage()">✏️ Изменить</button>
            <button class="message-action-btn danger" onclick="deleteMessage()">🗑 Удалить</button>
            <button class="message-action-btn" onclick="pinMessage()">📌 Закрепить</button>
        `;
    }
    actions.innerHTML = btns;
    actions.classList.toggle('active');
    selectedMessageId = messageId;
}

function replyToMessage() {
    const text = prompt('Введите ответ:');
    if (text && text.trim()) {
        socket.emit('send_message', { receiver_id: currentChatId, text: text.trim(), reply_to_id: selectedMessageId }, (response) => {
            if (response && response.status === 'ok' && typeof renderSingleMessage === 'function') {
                renderSingleMessage(response.message);
                if (typeof scrollToBottom === 'function') scrollToBottom();
            }
        });
    }
    document.getElementById('message-actions')?.classList.remove('active');
}

function forwardMessage() {
    const chatId = prompt('Введите ID пользователя для пересылки:');
    if (chatId && chatId.trim()) {
        socket.emit('forward_message', { message_id: selectedMessageId, to_id: chatId.trim() }, (response) => {
            if (response && response.status === 'ok') alert('✅ Сообщение переслано');
        });
    }
    document.getElementById('message-actions')?.classList.remove('active');
}

function copyMessage() {
    const msgEl = document.querySelector(`[data-message-id="${selectedMessageId}"]`);
    if (msgEl) {
        const spanText = msgEl.querySelector('span')?.innerText || '';
        navigator.clipboard.writeText(spanText).then(() => { alert('📋 Сообщение скопировано'); });
    }
    document.getElementById('message-actions')?.classList.remove('active');
}

function editMessage() {
    const newText = prompt('Введите новый text:');
    if (newText && newText.trim()) {
        socket.emit('edit_message', { message_id: selectedMessageId, text: newText.trim() }, (response) => {
            if (response && response.status === 'ok') {
                const msgEl = document.querySelector(`[data-message-id="${selectedMessageId}"]`);
                if (msgEl) {
                    const span = msgEl.querySelector('span');
                    if (span && typeof formatMessageText === 'function') span.innerHTML = formatMessageText(newText.trim());
                }
                document.getElementById('message-actions')?.classList.remove('active');
            }
        });
    }
}

function deleteMessage() {
    if (confirm('🗑 Удалить сообщение?')) {
        socket.emit('delete_message', { message_id: selectedMessageId }, (response) => {
            if (response && response.status === 'ok') {
                document.querySelector(`[data-message-id="${selectedMessageId}"]`)?.closest('.message-wrapper')?.remove();
                document.getElementById('message-actions')?.classList.remove('active');
            }
        });
    }
}

function pinMessage() {
    socket.emit('pin_message', { message_id: selectedMessageId }, (response) => {
        if (response && response.status === 'ok') alert('📌 Сообщение закреплено');
    });
    document.getElementById('message-actions')?.classList.remove('active');
}

function showReactionPicker(messageId) {
    currentMessageId = messageId;
    let picker = document.getElementById('reaction-picker');
    if (!picker) {
        picker = document.createElement('div');
        picker.id = 'reaction-picker';
        picker.className = 'reaction-picker';
        picker.innerHTML = REACTIONS.map(r => `<span class="reaction-emoji" onclick="addReaction('${r}')">${r}</span>`).join('');
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
    socket.emit('add_reaction', { message_id: currentMessageId, reaction: emoji }, (response) => {
        if (response && response.status === 'ok') updateReactionDisplay(currentMessageId);
    });
    document.getElementById('reaction-picker')?.classList.remove('active');
}

function updateReactionDisplay(messageId) {
    socket.emit('get_reactions', { message_id: messageId }, (reactions) => {
        const msgEl = document.querySelector(`[data-message-id="${messageId}"]`);
        if (!msgEl) return;
        msgEl.querySelector('.reactions')?.remove();
        
        if (reactions && reactions.length > 0) {
            const container = document.createElement('div');
            container.className = 'reactions';
            const grouped = {};
            reactions.forEach(r => { if (!grouped[r.reaction]) grouped[r.reaction] = []; grouped[r.reaction].push(r.user_id); });
            
            Object.entries(grouped).forEach(([emoji, users]) => {
                const span = document.createElement('span');
                span.className = 'reaction-item';
                span.innerText = `${emoji} ${users.length}`;
                container.appendChild(span);
            });
            msgEl.appendChild(container);
        }
    });
}

if (socket) {
    socket.on('message_read', (data) => {
        const ticks = document.querySelector(`[data-message-id="${data.message_id}"] .status-ticks`);
        if (ticks) {
            ticks.className = 'status-ticks read';
            ticks.innerHTML = `<svg viewBox="0 0 24 24"><path d="M18 7l-1.41-1.41L10 12.17 7.41 9.59 6 11l4 4zm-4.24 0L12.35 5.59 6 11.94l1.41 1.41z"/></svg>`;
        }
    });
    socket.on('reaction_updated', (data) => { updateReactionDisplay(data.message_id); });
}

console.log('✅ Chat module fully loaded');

