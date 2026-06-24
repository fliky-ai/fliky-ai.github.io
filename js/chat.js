// ============ ЛОГИКА ЧАТОВ ============
let currentChatId = null;
let dynamicChats = {};
let unreadCounts = {};
let selectedMessageId = null;
window.isInitialLoad = true;
let chatsLoaded = false;

// ============ РЕАКЦИИ ============
let currentMessageId = null;
const REACTIONS = ['👍', '❤️', '🔥', '😂', '😮', '😢'];
let reactionPickerTimeout = null;

const BLUE_VERIFY_SVG = `<svg class="tg-verify-icon" style="width:16px;height:16px;fill:#2f8cc9;vertical-align:middle;margin-left:4px;" viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>`;

let renderedMessageIds = new Set();

// Безопасное получение ID системных чатов из глобального конфига или дефолты
function getSupportId() {
    return (window.CONFIG && window.CONFIG.SUPPORT_ID) ? window.CONFIG.SUPPORT_ID : '0';
}
function getBotfatherId() {
    return (window.CONFIG && window.CONFIG.BOTFATHER_ID) ? window.CONFIG.BOTFATHER_ID : 'botfather';
}
function getCreatorId() {
    return (window.CONFIG && window.CONFIG.CREATOR_ID) ? window.CONFIG.CREATOR_ID : '8771009385';
}

// ============ ИНИЦИАЛИЗАЦИЯ ЧАТОВ ============
function initChats() {
    console.log('🔄 initChats() вызван');
    if (socket && isConnected) {
        loadChatsAndMessages();
    } else {
        console.log('⏳ Сокет ещё не готов, повтор через 1 сек');
        setTimeout(initChats, 1000);
    }
}

// ============ ЗАГРУЗКА ЧАТОВ ============
function loadChatsAndMessages() {
    if (!socket || !isConnected) {
        console.log('⏳ Ожидание соединения...');
        setTimeout(loadChatsAndMessages, 1000);
        return;
    }

    console.log('📥 Загрузка чатов...');
    
    const supportId = getSupportId();
    const botfatherId = getBotfatherId();
    
    if (!dynamicChats[supportId]) {
        dynamicChats[supportId] = {
            first_name: 'DICEGRAM SUPPORT',
            username: 'dicegram_support',
            chat_type: 'private',
            is_verified: true
        };
    }
    
    if (!dynamicChats[botfatherId]) {
        dynamicChats[botfatherId] = {
            first_name: 'BotFather',
            username: 'botfather',
            chat_type: 'private',
            is_verified: false
        };
    }

    socket.emit('get_all_chats', {}, (response) => {
        console.log('📨 Получен сырой ответ get_all_chats:', response);
        
        const chatsList = document.getElementById('chats-list');
        if (!chatsList) {
            console.error('❌ Элемент chats-list не найден!');
            return;
        }
        chatsList.innerHTML = '';
        
        // Всегда железно добавляем SUPPORT и BOTFATHER наверх списка
        createChatRow(supportId, 'DICEGRAM SUPPORT', 'dicegram_support', true);
        createChatRow(botfatherId, 'BotFather', 'botfather', false);
        
        // Парсим ответ: это может быть массив или объект {status: 'ok', chats: [...]}
        let chatsArray = [];
        if (response) {
            if (Array.isArray(response)) {
                chatsArray = response;
            } else if (response.chats && Array.isArray(response.chats)) {
                chatsArray = response.chats;
            } else if (response.data && Array.isArray(response.data)) {
                chatsArray = response.data;
            }
        }

        console.log('📊 Массив чатов к отрисовке:', chatsArray.length);
        const myId = window.MY_ID || '8771009385';

        chatsArray.forEach(chat => {
            try {
                const partnerId = chat.chat_id || chat.partner_id;
                const chatType = chat.type || 'private';
                
                if (partnerId && partnerId.toString() !== myId.toString() && 
                    partnerId.toString() !== supportId.toString() && 
                    partnerId.toString() !== botfatherId.toString()) {
                    
                    if (!dynamicChats[partnerId]) {
                        dynamicChats[partnerId] = {
                            first_name: chat.name || chat.partner_name || `User ${partnerId}`,
                            username: chat.username || chat.partner_username || `@user${partnerId}`,
                            chat_type: chatType,
                            members_count: chat.members_count || 0,
                            role: chat.role || 'member',
                            is_verified: chat.is_verified || false,
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
            } catch (err) {
                console.error('❌ Ошибка парсинга строки чата:', err, chat);
            }
        });
        
        chatsLoaded = true;
        
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
            chat_type: chatType,
            is_verified: isVerified
        };
    } else {
        dynamicChats[tgId].is_verified = isVerified;
    }
    
    const chatsList = document.getElementById('chats-list');
    if (!chatsList) return;
    if (document.getElementById(`chat-item-${tgId}`)) return;
    
    const supportId = getSupportId();
    const creatorId = getCreatorId();
    
    const isBotFather = username === 'botfather' || tgId === getBotfatherId();
    const isSupport = tgId === supportId;
    const verified = isSupport || tgId === creatorId || isVerified;
    
    const verifiedIcon = verified ? BLUE_VERIFY_SVG : '';
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
        <div class="chat-item" id="chat-item-${tgId}" onclick="openChat('${tgId}')">
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
function openChat(chatId) {
    console.log('📂 openChat вызван с ID:', chatId);
    if (!chatId || !socket || !isConnected) return;

    currentChatId = chatId;
    renderedMessageIds.clear(); 
    
    unreadCounts[chatId] = 0;
    updateUnreadBadge(chatId, 0);
    
    const chatInfo = dynamicChats[chatId];
    const chatName = chatInfo ? chatInfo.first_name : `User ${chatId}`;
    const chatType = chatInfo ? chatInfo.chat_type : 'private';
    
    const titleEl = document.getElementById('chat-room-title');
    if (titleEl) titleEl.innerText = chatName || 'Чат';
    
    if (chatInfo && titleEl) {
        if (chatInfo.chat_type === 'group') {
            titleEl.innerText = '👥 ' + (chatName || 'Группа');
        } else if (chatInfo.chat_type === 'channel') {
            titleEl.innerText = '📢 ' + (chatName || 'Канал');
        }
    }
    
    const messagesContainer = document.getElementById('chat-messages');
    if (messagesContainer) messagesContainer.innerHTML = '';

    if (chatType === 'group' || chatType === 'channel') {
        socket.emit('join_chat', { chat_id: chatId }, (response) => {
            if (response && response.status === 'ok') {
                console.log(`✅ Присоединился к комнате группы ${chatId}`);
            }
        });
    }

    const supportId = getSupportId();
    if (chatId.toString() === supportId.toString() && titleEl) {
        titleEl.innerHTML = `DICEGRAM SUPPORT ${BLUE_VERIFY_SVG}`;
        const statusEl = document.getElementById('chat-room-status');
        if (statusEl) statusEl.innerText = 'официальный аккаунт';

        const tgUserData = window.Telegram?.WebApp?.initDataUnsafe?.user;
        const finalName = tgUserData?.first_name || 'Пользователь';
        const finalUsername = tgUserData?.username || 'не установлен';
        const finalId = tgUserData?.id || window.MY_ID || '8771009385';

        const welcomeMsg = {
            id: 'welcome_msg_static',
            sender_id: supportId,
            receiver_id: finalId,
            text: `👋 Добро пожаловать в DICEGRAM!\n\n🆔 Ваш ID: ${finalId}\n👤 Имя: ${finalName}\n🏷️ Username: @${finalUsername}\n\n📱 DICEGRAM — точная копия Telegram. Все данные сохраняются в базе данных.\n\n💬 Напишите нам, если у вас есть вопросы или предложения.`,
            timestamp: new Date().toISOString(),
            is_read: true
        };
        renderSingleMessageWithCheck(welcomeMsg);
    }

    socket.emit('get_user_info', { user_id: chatId }, (userInfo) => {
        const statusEl = document.getElementById('chat-room-status');
        if (!statusEl) return;
        
        if (userInfo && userInfo.status === 'found') {
            const isVerifiedUser = userInfo.user.is_verified || chatId.toString() === supportId.toString() || chatId.toString() === getCreatorId().toString();
            if (isVerifiedUser && chatId.toString() !== supportId.toString() && titleEl) {
                titleEl.innerHTML = `${titleEl.innerText} ${BLUE_VERIFY_SVG}`;
            }
            if (chatId.toString() !== supportId.toString()) {
                statusEl.innerText = userInfo.user.is_online ? '🟢 в сети' : 'был(а) недавно';
            }
        } else {
            if (chatInfo && (chatInfo.chat_type === 'group' || chatInfo.chat_type === 'channel')) {
                statusEl.innerText = `${chatInfo.members_count || 0} участников`;
            }
        }
    });

    if (document.getElementById('bottom-navigation')) document.getElementById('bottom-navigation').style.display = 'none';
    if (document.getElementById('chat-room')) document.getElementById('chat-room').style.display = 'flex';

    socket.emit('get_chat_history', { with_id: chatId }, (history) => {
        if (history && Array.isArray(history)) {
            history.forEach(msg => {
                if (chatId.toString() === supportId.toString() && msg.text && msg.text.includes("Добро пожаловать в DICEGRAM!")) {
                    return; 
                }
                renderSingleMessageWithCheck(msg);
            });
            if (window.scrollToBottom) window.scrollToBottom();
        }
    });

    socket.emit('mark_as_read', { chat_id: chatId });
    if (chatInfo && chatInfo.chat_type === 'channel') {
        checkChannelPermission(chatId);
    }
}

// ============ ОТОБРАЖЕНИЕ СООБЩЕНИЯ С ПРОВЕРКОЙ ============
function renderSingleMessageWithCheck(msg) {
    if (!msg || !msg.text) return;
    
    const msgId = msg.id || msg._id || Date.now().toString() + '_' + Math.random().toString(36).substr(2, 5);
    if (renderedMessageIds.has(msgId)) return;
    
    renderedMessageIds.add(msgId);
    
    const container = document.getElementById('chat-messages');
    if (!container) return;
    
    const wrapper = document.createElement('div');
    wrapper.classList.add('message-wrapper');

    const msgEl = document.createElement('div');
    msgEl.classList.add('message');
    msgEl.dataset.messageId = msgId;

    const timeStr = window.getLocalTime ? window.getLocalTime(msg.timestamp) : new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

    if (msg.sender_id === 'system') {
        msgEl.classList.add('system-message');
        msgEl.innerHTML = `
            <div class="system-message-content">
                <span>${window.formatMessageText ? window.formatMessageText(msg.text) : msg.text}</span>
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
    const myId = window.MY_ID || '8771009385';
    if (msg.sender_id.toString() === myId.toString()) {
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

    const formattedText = window.formatMessageText ? window.formatMessageText(msg.text) : msg.text;

    msgEl.innerHTML = `
        <span>${formattedText}</span>
        <div class="message-meta">
            <span class="message-time">${timeStr}</span>
            ${ticksHtml}
        </div>
    `;

    let longPressTimer = null;
    const startPress = () => { longPressTimer = setTimeout(() => showMessageActions(msgId), 500); };
    const endPress = () => clearTimeout(longPressTimer);

    msgEl.addEventListener('mousedown', startPress);
    msgEl.addEventListener('mouseup', endPress);
    msgEl.addEventListener('mouseleave', endPress);
    msgEl.addEventListener('touchstart', startPress);
    msgEl.addEventListener('touchend', endPress);
    msgEl.addEventListener('touchmove', endPress);

    wrapper.appendChild(msgEl);
    container.appendChild(wrapper);
}

// ============ ПРОВЕРКА ПРАВ В КАНАЛЕ ============
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

// ============ ЗАКРЫТИЕ ЧАТА ============
function closeChat() {
    if (document.getElementById('chat-room')) document.getElementById('chat-room').style.display = 'none';
    if (document.getElementById('bottom-navigation')) document.getElementById('bottom-navigation').style.display = 'flex';
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

// ============ ОБРАБОТКА НОВОГО СООБЩЕНИЯ ============
function handleNewMessage(msg) {
    if (!msg) return;
    const myId = window.MY_ID || '8771009385';
    let chatId = msg.receiver_id;
    
    if (msg.sender_id.toString() === myId.toString()) {
        chatId = msg.receiver_id;
    } else if (msg.receiver_id.toString() === myId.toString()) {
        chatId = msg.sender_id;
    }
    
    if (msg.sender_id === 'system') {
        if (currentChatId && currentChatId.toString() === msg.receiver_id.toString()) {
            renderSingleMessageWithCheck(msg);
            if (window.scrollToBottom) window.scrollToBottom();
        }
        const previewEl = document.getElementById(`preview-${msg.receiver_id}`);
        if (previewEl) {
            let previewText = msg.text;
            const chatInfo = dynamicChats[msg.receiver_id];
            if (chatInfo && chatInfo.chat_type === 'group') previewText = '👥 ' + previewText;
            previewEl.innerText = previewText;
        }
        return;
    }
    
    const isCurrentChat = currentChatId && currentChatId.toString() === chatId.toString();
    if (isCurrentChat) {
        renderSingleMessageWithCheck(msg);
        if (window.scrollToBottom) window.scrollToBottom();
        if (msg.sender_id.toString() !== myId.toString()) {
            socket.emit('mark_as_read', { chat_id: chatId });
        }
    } else {
        if (msg.sender_id.toString() !== myId.toString()) {
            unreadCounts[chatId] = (unreadCounts[chatId] || 0) + 1;
            updateUnreadBadge(chatId, unreadCounts[chatId]);
        }
    }
    
    const previewEl = document.getElementById(`preview-${chatId}`);
    if (previewEl) {
        let previewText = msg.text;
        const chatInfo = dynamicChats[chatId];
        if (chatInfo) {
            if (chatInfo.chat_type === 'group') previewText = '👥 ' + previewText;
            if (chatInfo.chat_type === 'channel') previewText = '📢 ' + previewText;
        }
        previewEl.innerText = previewText;
    }
    
    const timeEl = document.getElementById(`time-${chatId}`);
    if (timeEl && msg.timestamp) {
        timeEl.innerText = window.getLocalTime ? window.getLocalTime(msg.timestamp) : new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    }
    
    if (chatId && chatId.toString() !== myId.toString() && !dynamicChats[chatId]) {
        socket.emit('get_group_info', { chat_id: chatId }, (groupInfo) => {
            if (groupInfo && groupInfo.status === 'found') {
                const chat = groupInfo.chat;
                dynamicChats[chatId] = {
                    first_name: chat.name || 'Группа',
                    username: '',
                    chat_type: chat.type || 'group',
                    members_count: 0,
                    is_verified: false
                };
                createChatRow(chatId, chat.name || 'Группа', '', false, chat.type || 'group');
            } else {
                socket.emit('get_user_info', { user_id: chatId }, (userInfo) => {
                    if (userInfo && userInfo.status === 'found') {
                        dynamicChats[chatId] = {
                            first_name: userInfo.user.first_name || `User ${chatId}`,
                            username: userInfo.user.username || `@user${chatId}`,
                            chat_type: 'private',
                            is_verified: userInfo.user.is_verified || false
                        };
                        const isVerified = userInfo.user.is_verified || chatId.toString() === getSupportId().toString();
                        createChatRow(chatId, dynamicChats[chatId].first_name, dynamicChats[chatId].username, isVerified, 'private');
                    }
                });
            }
        });
    }
}

// ============ ОТПРАВКА СООБЩЕНИЯ ============
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

    if (!socket || !isConnected) {
        alert('Нет соединения с сервером');
        return;
    }

    const chatInfo = dynamicChats[currentChatId];
    if (chatInfo && chatInfo.chat_type === 'channel') {
        socket.emit('check_channel_permission', { chat_id: currentChatId }, (response) => {
            if (response && response.status === 'ok') {
                if (!response.can_write) {
                    alert('📢 Только владелец канала может отправлять сообщения');
                    return;
                }
                sendMessageToServer(text);
            }
        });
        return;
    }

    const botfatherId = getBotfatherId();
    if (currentChatId.toString() === botfatherId.toString() || (dynamicChats[currentChatId] && dynamicChats[currentChatId].username === 'botfather')) {
        handleBotCommand(text);
        input.value = '';
        const sendBtn = document.getElementById('send-btn-icon');
        if (sendBtn) sendBtn.classList.remove('active');
        return;
    }

    sendMessageToServer(text);
}

function sendMessageToServer(text) {
    const input = document.getElementById('message-field');
    const tempId = 'temp_' + Date.now();
    const myId = window.MY_ID || '8771009385';
    
    const localMsg = {
        id: tempId,
        sender_id: myId,
        receiver_id: currentChatId,
        text: text,
        timestamp: new Date().toISOString(),
        is_read: false,
        delivered: false
    };
    renderSingleMessageWithCheck(localMsg);
    if (window.scrollToBottom) window.scrollToBottom();
    
    socket.emit('send_message', { receiver_id: currentChatId, text: text }, (response) => {
        if (response && response.status === 'ok') {
            const tempEl = document.querySelector(`[data-message-id="${tempId}"]`);
            if (tempEl) {
                const wrapper = tempEl.closest('.message-wrapper');
                if (wrapper) wrapper.remove();
                renderedMessageIds.delete(tempId);
            }
            if (response.message) {
                renderSingleMessageWithCheck(response.message);
                if (window.scrollToBottom) window.scrollToBottom();
            }
        }
    });

    if (input) {
        input.value = '';
        const sendBtn = document.getElementById('send-btn-icon');
        if (sendBtn) sendBtn.classList.remove('active');
        input.focus();
    }
}

// ============ СИСТЕМА РЕАКЦИЙ ============
function showReactionPicker(messageId) {
    currentMessageId = messageId;
    let picker = document.getElementById('reaction-picker');
    
    if (!picker) {
        picker = document.createElement('div');
        picker.id = 'reaction-picker';
        picker.className = 'reaction-picker';
        picker.innerHTML = REACTIONS.map(r => 
            `<span class="reaction-emoji" data-reaction="${r}" onclick="addReaction('${r}')">${r}</span>`
        ).join('');
        document.body.appendChild(picker);
    }
    
    const msgEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (msgEl) {
        const rect = msgEl.getBoundingClientRect();
        picker.style.left = `${Math.max(10, rect.left + rect.width / 2 - 110)}px`;
        picker.style.top = `${rect.top - 55}px`;
        picker.style.display = 'flex';
    }
    
    clearTimeout(reactionPickerTimeout);
    reactionPickerTimeout = setTimeout(hideReactionPicker, 5000);
    const actions = document.getElementById('message-actions');
    if (actions) actions.classList.remove('active');
}

function hideReactionPicker() {
    const picker = document.getElementById('reaction-picker');
    if (picker) picker.style.display = 'none';
}

function addReaction(emoji) {
    if (!currentMessageId || !socket || !isConnected) return;
    
    socket.emit('add_reaction', { message_id: currentMessageId, reaction: emoji }, (response) => {
        if (response && response.status === 'ok') {
            if (response.reactions) {
                updateReactionDisplayDirect(currentMessageId, response.reactions);
            } else {
                updateReactionDisplay(currentMessageId);
            }
        }
    });
    hideReactionPicker();
}

function updateReactionDisplayDirect(messageId, reactions) {
    const msgEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!msgEl) return;
    
    let container = msgEl.querySelector('.reactions');
    if (!container) {
        container = document.createElement('div');
        container.className = 'reactions';
        msgEl.appendChild(container);
    } else {
        container.innerHTML = '';
    }
    
    if (!reactions || reactions.length === 0) {
        container.style.display = 'none';
        return;
    }
    
    container.style.display = 'flex';
    const grouped = {};
    reactions.forEach(r => {
        if (!grouped[r.reaction]) grouped[r.reaction] = [];
        grouped[r.reaction].push(r.user_id);
    });
    
    Object.entries(grouped).forEach(([emoji, users]) => {
        const span = document.createElement('span');
        span.className = 'reaction-item';
        span.innerHTML = `${emoji} <span class="count">${users.length}</span>`;
        container.appendChild(span);
    });
}

function updateReactionDisplay(messageId) {
    socket.emit('get_reactions', { message_id: messageId }, (reactions) => {
        updateReactionDisplayDirect(messageId, reactions);
    });
}

window.updateReactionDisplayDirect = updateReactionDisplayDirect;

// ============ ОСТАЛЬНОЙ ФУНКЦИОНАЛ (ПОИСК, ДЕЙСТВИЯ, BOTFATHER) ============
function handleBotCommand(text) {
    const botfatherId = getBotfatherId();
    const botResponse = emulateBotFather(text);
    const myId = window.MY_ID || '8771009385';
    const userMsg = { id: Date.now().toString(), sender_id: myId, receiver_id: botfatherId, text: text, timestamp: new Date().toISOString(), is_read: true };
    renderSingleMessageWithCheck(userMsg);
    
    setTimeout(() => {
        const botMsg = { id: (Date.now() + 1).toString(), sender_id: botfatherId, receiver_id: myId, text: botResponse, timestamp: new Date().toISOString(), is_read: true };
        renderSingleMessageWithCheck(botMsg);
        if (window.scrollToBottom) window.scrollToBottom();
    }, 500);
}

function emulateBotFather(text) {
    const lower = text.toLowerCase().trim();
    if (lower === '/start') return `I can help you create and manage Telegram bots.\n\n/newbot - create a new bot\n/mybots - edit your bots`;
    if (lower === '/newbot') return `Alright, a new bot. How are we going to call it? Please choose a name for your bot.`;
    
    if (!window.botCreationStep) {
        window.botCreationStep = 'name';
        return `Good. Now let's choose a username for your bot. It must end in \`bot\`.`;
    } else if (window.botCreationStep === 'name') {
        window.botCreationStep = 'username';
        return `Good. Now let's choose a username for your bot.`;
    } else if (window.botCreationStep === 'username') {
        if (!text.trim().endsWith('bot')) return `Sorry, the username must end with 'bot'.`;
        window.botCreationStep = null;
        return `Done! Congratulations on your new bot.\n\nUse this token to access the HTTP API:\n${Math.random().toString(36).substr(2)}${Math.random().toString(36).substr(2)}`;
    }
    return `I don't understand that command.`;
}

function handleSearch(query) {
    const resultsContainer = document.getElementById('search-results');
    if (!resultsContainer) return;
    if (!query.trim()) { resultsContainer.style.display = 'none'; return; }

    const myId = window.MY_ID || '8771009385';

    socket.emit('search_users', { query: query.trim() }, (results) => {
        resultsContainer.innerHTML = '';
        if (results && results.length > 0) {
            resultsContainer.style.display = 'block';
            results.forEach(user => {
                if (user.telegram_id.toString() === myId.toString()) return;
                const item = document.createElement('div');
                item.className = 'search-result-item';
                const isVerified = user.telegram_id.toString() === getCreatorId().toString() || user.is_verified || user.telegram_id.toString() === getSupportId().toString();
                item.innerHTML = `
                    <div class="chat-avatar" style="width:36px;height:36px;font-size:12px;background:linear-gradient(135deg, #5085b1, #366187)">
                        ${(user.first_name || 'U').substring(0,2).toUpperCase()}
                    </div>
                    <div>
                        <div style="font-weight:600;">${user.first_name || 'User'}</div>
                        <div style="font-size:12px;color:var(--tg-text-secondary);">@${user.username || ''}</div>
                    </div>
                `;
                item.onclick = () => {
                    if (!dynamicChats[user.telegram_id]) {
                        createChatRow(user.telegram_id, user.first_name, user.username, isVerified);
                    }
                    openChat(user.telegram_id);
                    resultsContainer.style.display = 'none';
                    document.getElementById('global-search').value = '';
                };
                resultsContainer.appendChild(item);
            });
        }
    });
}

function showMessageActions(messageId) {
    const msgEl = document.querySelector(`[data-message-id="${messageId}"]`);
    const actions = document.getElementById('message-actions');
    if (!msgEl || !actions) return;
    
    const wrapper = msgEl.closest('.message-wrapper');
    const isSent = wrapper.classList.contains('sent');
    
    actions.innerHTML = `
        <button class="message-action-btn" onclick="copyMessage()">📋 Копировать</button>
        <button class="message-action-btn" onclick="showReactionPicker('${messageId}')">😊 Реакция</button>
        ${isSent ? `<button class="message-action-btn danger" onclick="deleteMessage()">🗑 Удалить</button>` : ''}
    `;
    actions.classList.toggle('active');
    selectedMessageId = messageId;
}

function copyMessage() {
    const msgEl = document.querySelector(`[data-message-id="${selectedMessageId}"]`);
    if (msgEl) {
        navigator.clipboard.writeText(msgEl.querySelector('span').innerText);
    }
    if (document.getElementById('message-actions')) document.getElementById('message-actions').classList.remove('active');
}

function deleteMessage() {
    socket.emit('delete_message', { message_id: selectedMessageId }, (response) => {
        if (response && response.status === 'ok') {
            const msgEl = document.querySelector(`[data-message-id="${selectedMessageId}"]`);
            if (msgEl) msgEl.closest('.message-wrapper').remove();
        }
    });
    if (document.getElementById('message-actions')) document.getElementById('message-actions').classList.remove('active');
}

document.addEventListener('click', function(e) {
    const picker = document.getElementById('reaction-picker');
    if (picker && picker.style.display === 'flex' && !picker.contains(e.target)) hideReactionPicker();
});

setTimeout(initChats, 500);
console.log('✅ Chat module loaded (исправленная версия)');
