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
    
    if (chatInfo && chatInfo.chat_type === 'channel') {
        checkChannelPermission(chatId);
    }
}

// ============ ПРОВЕРКА ПРАВ В КАНАЛЕ ============
function checkChannelPermission(chatId) {
    socket.emit('check_channel_permission', { chat_id: chatId }, (response) => {
        if (response && response.status === 'ok') {
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
    
    const input = document.getElementById('message-field');
    const sendBtn = document.getElementById('send-btn-icon');
    input.disabled = false;
    input.placeholder = 'Сообщение...';
    sendBtn.style.opacity = '1';
    sendBtn.style.cursor = 'pointer';
}

// ============ ОБРАБОТКА НОВОГО СООБЩЕНИЯ ============
function handleNewMessage(msg) {
    console.log('📩 Новое сообщение:', msg);
    
    const chatPartner = msg.sender_id === MY_ID ? msg.receiver_id : msg.sender_id;
    
    if (msg.sender_id === 'system') {
        renderSingleMessage(msg);
        scrollToBottom();
        return;
    }

    if (chatPartner && chatPartner !== MY_ID) {
        if (!dynamicChats[chatPartner]) {