// ============ ЛОГИКА ЧАТОВ ============
let currentChatId = null;
let dynamicChats = {};
let unreadCounts = {};
let selectedMessageId = null;
let isInitialLoad = true;

// ============ РЕАКЦИИ ============
let currentMessageId = null;
const REACTIONS = ['👍', '❤️', '🔥', '😂', '😮', '😢'];
let reactionPickerTimeout = null;

const BLUE_VERIFY_SVG = `<svg class="tg-verify-icon" style="width:16px;height:16px;fill:#2f8cc9;vertical-align:middle;margin-left:4px;" viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>`;

let renderedMessageIds = new Set();

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
            username: 'dicegram_support',
            chat_type: 'private',
            is_verified: true
        };
    }
    
    if (!dynamicChats[CONFIG.BOTFATHER_ID]) {
        dynamicChats[CONFIG.BOTFATHER_ID] = {
            first_name: 'BotFather',
            username: 'botfather',
            chat_type: 'private',
            is_verified: false
        };
    }

    socket.emit('get_all_chats', {}, (chats) => {
        console.log('📨 Получены чаты:', chats?.length || 0);
        
        const chatsList = document.getElementById('chats-list');
        chatsList.innerHTML = '';
        
        createChatRow(CONFIG.SUPPORT_ID, 'DICEGRAM SUPPORT', 'dicegram_support', true);
        createChatRow(CONFIG.BOTFATHER_ID, 'BotFather', 'botfather', false);
        
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
            chat_type: chatType,
            is_verified: isVerified
        };
    } else {
        dynamicChats[tgId].is_verified = isVerified;
    }
    
    const chatsList = document.getElementById('chats-list');
    if (document.getElementById(`chat-item-${tgId}`)) return;
    
    const isBotFather = username === 'botfather';
    const isSupport = tgId === CONFIG.SUPPORT_ID;
    const verified = isSupport || tgId === CONFIG.CREATOR_ID || isVerified;
    
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
    
    if (!chatId) {
        console.error('❌ chatId не передан');
        return;
    }
    
    if (!socket || !isConnected) {
        alert('Нет соединения с сервером');
        return;
    }

    currentChatId = chatId;
    renderedMessageIds.clear();
    
    unreadCounts[chatId] = 0;
    updateUnreadBadge(chatId, 0);
    
    const chatInfo = dynamicChats[chatId];
    const chatName = chatInfo ? chatInfo.first_name : `User ${chatId}`;
    const chatType = chatInfo ? chatInfo.chat_type : 'private';
    
    const titleEl = document.getElementById('chat-room-title');
    titleEl.innerText = chatName || 'Чат';
    
    if (chatInfo) {
        if (chatInfo.chat_type === 'group') {
            titleEl.innerText = '👥 ' + (chatName || 'Группа');
        } else if (chatInfo.chat_type === 'channel') {
            titleEl.innerText = '📢 ' + (chatName || 'Канал');
        }
    }
    
    const messagesContainer = document.getElementById('chat-messages');
    messagesContainer.innerHTML = '';

    // ============ КЛЮЧЕВОЕ: ПРИСОЕДИНЯЕМСЯ К КОМНАТЕ ГРУППЫ ============
    if (chatType === 'group' || chatType === 'channel') {
        socket.emit('join_chat', { chat_id: chatId }, (response) => {
            if (response && response.status === 'ok') {
                console.log(`✅ Присоединился к комнате группы ${chatId}`);
            } else {
                console.warn(`⚠️ Ошибка присоединения к группе ${chatId}:`, response);
            }
        });
    }

    // Приветствие SUPPORT
    if (chatId === CONFIG.SUPPORT_ID) {
        titleEl.innerHTML = `DICEGRAM SUPPORT ${BLUE_VERIFY_SVG}`;
        document.getElementById('chat-room-status').innerText = 'официальный аккаунт';

        const tgUserData = window.Telegram?.WebApp?.initDataUnsafe?.user;
        const finalName = tgUserData?.first_name || tgUser.first_name || 'Пользователь';
        const finalUsername = tgUserData?.username || tgUser.username || 'не установлен';
        const finalId = tgUserData?.id || MY_ID || '8771009385';

        const welcomeMsg = {
            id: 'welcome_msg_static',
            sender_id: CONFIG.SUPPORT_ID,
            receiver_id: finalId,
            text: `👋 Добро пожаловать в DICEGRAM!\n\n🆔 Ваш ID: ${finalId}\n👤 Имя: ${finalName}\n🏷️ Username: @${finalUsername}\n\n📱 DICEGRAM — точная копия Telegram. Все данные сохраняются в базе данных.\n\n💬 Напишите нам, если у вас есть вопросы или предложения.`,
            timestamp: new Date().toISOString(),
            is_read: true
        };
        renderSingleMessageWithCheck(welcomeMsg);
    }

    socket.emit('get_user_info', { user_id: chatId }, (userInfo) => {
        if (userInfo && userInfo.status === 'found') {
            const isVerifiedUser = userInfo.user.is_verified || chatId === CONFIG.SUPPORT_ID || chatId === CONFIG.CREATOR_ID;
            if (isVerifiedUser && chatId !== CONFIG.SUPPORT_ID) {
                titleEl.innerHTML = `${titleEl.innerText} ${BLUE_VERIFY_SVG}`;
            }
            if (chatId !== CONFIG.SUPPORT_ID) {
                document.getElementById('chat-room-status').innerText = userInfo.user.is_online ? '🟢 в сети' : 'был(а) недавно';
            }
        } else {
            if (chatInfo && (chatInfo.chat_type === 'group' || chatInfo.chat_type === 'channel')) {
                document.getElementById('chat-room-status').innerText = `${chatInfo.members_count || 0} участников`;
            }
        }
    });

    document.getElementById('bottom-navigation').style.display = 'none';
    document.getElementById('chat-room').style.display = 'flex';

    socket.emit('get_chat_history', { with_id: chatId }, (history) => {
        console.log('📨 История чата:', history?.length || 0);
        if (history && Array.isArray(history)) {
            history.forEach(msg => {
                if (chatId === CONFIG.SUPPORT_ID && msg.text && msg.text.includes("Добро пожаловать в DICEGRAM!")) {
                    return; 
                }
                renderSingleMessageWithCheck(msg);
            });
            scrollToBottom();
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
    
    const msgId = msg.id || msg._id || Date.now().toString();
    
    if (renderedMessageIds.has(msgId)) {
        console.log(`⏭️ Сообщение ${msgId} уже отображено, пропускаем`);
        return;
    }
    
    renderedMessageIds.add(msgId);
    
    const container = document.getElementById('chat-messages');
    if (!container) return;
    
    const wrapper = document.createElement('div');
    wrapper.classList.add('message-wrapper');

    const msgEl = document.createElement('div');
    msgEl.classList.add('message');
    msgEl.dataset.messageId = msgId;

    const timeStr = getLocalTime(msg.timestamp);

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

    const formattedText = formatMessageText(msg.text);

    msgEl.innerHTML = `
        <span>${formattedText}</span>
        <div class="message-meta">
            <span class="message-time">${timeStr}</span>
            ${ticksHtml}
        </div>
    `;

    let longPressTimer = null;
    msgEl.addEventListener('mousedown', () => {
        longPressTimer = setTimeout(() => {
            showMessageActions(msgId);
        }, 500);
    });
    msgEl.addEventListener('mouseup', () => clearTimeout(longPressTimer));
    msgEl.addEventListener('mouseleave', () => clearTimeout(longPressTimer));
    
    msgEl.addEventListener('touchstart', () => {
        longPressTimer = setTimeout(() => {
            showMessageActions(msgId);
        }, 500);
    });
    msgEl.addEventListener('touchend', () => clearTimeout(longPressTimer));
    msgEl.addEventListener('touchmove', () => clearTimeout(longPressTimer));

    wrapper.appendChild(msgEl);
    container.appendChild(wrapper);
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

// ============ ИСПРАВЛЕННАЯ ОБРАБОТКА НОВОГО СООБЩЕНИЯ ============
function handleNewMessage(msg) {
    console.log('📩 Новое сообщение:', msg);
    
    // Определяем собеседника (для групповых чатов это receiver_id или sender_id)
    const chatPartner = msg.sender_id === MY_ID ? msg.receiver_id : msg.sender_id;
    
    // Если сообщение системное
    if (msg.sender_id === 'system') {
        renderSingleMessageWithCheck(msg);
        scrollToBottom();
        return;
    }
    
    // Проверяем, открыт ли этот чат
    const isCurrentChat = currentChatId === chatPartner || currentChatId === msg.receiver_id;
    
    if (isCurrentChat) {
        // Если чат открыт - показываем сообщение
        renderSingleMessageWithCheck(msg);
        scrollToBottom();
        // Отмечаем как прочитанное
        socket.emit('mark_as_read', { chat_id: chatPartner });
    } else {
        // Если чат не открыт - увеличиваем счетчик непрочитанных
        if (msg.sender_id !== MY_ID) {
            unreadCounts[chatPartner] = (unreadCounts[chatPartner] || 0) + 1;
            updateUnreadBadge(chatPartner, unreadCounts[chatPartner]);
        }
    }
    
    // Обновляем превью в списке чатов
    const previewEl = document.getElementById(`preview-${chatPartner}`);
    if (previewEl) {
        let previewText = msg.text;
        const chatInfo = dynamicChats[chatPartner];
        if (chatInfo) {
            if (chatInfo.chat_type === 'group') previewText = '👥 ' + previewText;
            if (chatInfo.chat_type === 'channel') previewText = '📢 ' + previewText;
        }
        previewEl.innerText = previewText;
    }
    
    // Если чат еще не существует в списке - создаем
    if (chatPartner && chatPartner !== MY_ID && !dynamicChats[chatPartner]) {
        // Проверяем, может это группа
        socket.emit('get_group_info', { chat_id: chatPartner }, (groupInfo) => {
            if (groupInfo && groupInfo.status === 'found') {
                const chat = groupInfo.chat;
                dynamicChats[chatPartner] = {
                    first_name: chat.name || 'Группа',
                    username: '',
                    chat_type: chat.type,
                    members_count: 0,
                    is_verified: false
                };
                createChatRow(chatPartner, chat.name || 'Группа', '', false, chat.type);
            } else {
                // Это пользователь
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
        });
    }
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

    const chatInfo = dynamicChats[currentChatId];
    if (chatInfo && chatInfo.chat_type === 'channel') {
        socket.emit('check_channel_permission', { chat_id: currentChatId }, (response) => {
            if (response && response.status === 'ok') {
                if (!response.can_write) {
                    alert('📢 Только владелец канала может отправлять сообщения');
                    return;
                }
                sendMessageToServer(text);
            } else {
                alert('Ошибка проверки прав');
            }
        });
        return;
    }

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
    
    socket.emit('send_message', { 
        receiver_id: currentChatId, 
        text: text 
    }, (response) => {
        if (response && response.status === 'ok') {
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

// ============ РЕАКЦИИ ============
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
        const pickerWidth = 220;
        let left = rect.left + rect.width / 2 - pickerWidth / 2;
        let top = rect.top - 55;
        
        if (top < 10) {
            top = rect.bottom + 10;
        }
        
        picker.style.left = `${Math.max(10, left)}px`;
        picker.style.top = `${top}px`;
        picker.style.display = 'flex';
    } else {
        picker.style.display = 'flex';
        picker.style.left = '50%';
        picker.style.top = '50%';
        picker.style.transform = 'translate(-50%, -50%)';
    }
    
    clearTimeout(reactionPickerTimeout);
    reactionPickerTimeout = setTimeout(() => {
        hideReactionPicker();
    }, 5000);
    
    document.getElementById('message-actions')?.classList.remove('active');
}

function hideReactionPicker() {
    const picker = document.getElementById('reaction-picker');
    if (picker) {
        picker.style.display = 'none';
    }
}

function addReaction(emoji) {
    if (!currentMessageId || !socket || !isConnected) {
        console.log('❌ Нельзя добавить реакцию');
        return;
    }
    
    console.log(`😊 Добавление реакции ${emoji} на сообщение ${currentMessageId}`);
    
    socket.emit('add_reaction', { 
        message_id: currentMessageId, 
        reaction: emoji 
    }, (response) => {
        if (response && response.status === 'ok') {
            console.log('✅ Реакция добавлена');
            if (response.reactions) {
                updateReactionDisplayDirect(currentMessageId, response.reactions);
            } else {
                updateReactionDisplay(currentMessageId);
            }
        } else {
            console.log('❌ Ошибка добавления реакции:', response);
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
        span.title = users.map(id => `User ${id}`).join(', ');
        container.appendChild(span);
    });
}

function updateReactionDisplay(messageId) {
    socket.emit('get_reactions', { message_id: messageId }, (reactions) => {
        updateReactionDisplayDirect(messageId, reactions);
    });
}

// ============ ОБРАБОТЧИКИ СОБЫТИЙ ============
if (socket) {
    socket.on('reaction_updated', (data) => {
        console.log('📢 Обновление реакций:', data);
        if (data.message_id && data.reactions) {
            updateReactionDisplayDirect(data.message_id, data.reactions);
        }
    });

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
}

// ============ ОСТАЛЬНЫЕ ФУНКЦИИ ============
function handleBotCommand(text) {
    const botResponse = emulateBotFather(text);
    
    const userMsg = {
        id: Date.now().toString(),
        sender_id: MY_ID,
        receiver_id: CONFIG.BOTFATHER_ID,
        text: text,
        timestamp: new Date().toISOString(),
        is_read: true
    };
    renderSingleMessageWithCheck(userMsg);
    
    setTimeout(() => {
        const botMsg = {
            id: (Date.now() + 1).toString(),
            sender_id: CONFIG.BOTFATHER_ID,
            receiver_id: MY_ID,
            text: botResponse,
            timestamp: new Date().toISOString(),
            is_read: true
        };
        renderSingleMessageWithCheck(botMsg);
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
                const isVerified = user.telegram_id === CONFIG.CREATOR_ID || user.is_verified || user.telegram_id === CONFIG.SUPPORT_ID;
                const verifyBadge = isVerified ? `<span class="verified-check">✅</span>` : '';
                item.innerHTML = `
                    <div class="chat-avatar" style="width:36px;height:36px;font-size:12px;background:linear-gradient(135deg, #5085b1, #366187)">
                        ${(user.first_name || 'U').substring(0,2).toUpperCase()}
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
                    openChat(user.telegram_id);
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

// Закрываем пикер при клике вне его
document.addEventListener('click', function(e) {
    const picker = document.getElementById('reaction-picker');
    if (picker && picker.style.display === 'flex') {
        if (!picker.contains(e.target)) {
            hideReactionPicker();
        }
    }
});

console.log('✅ Chat module loaded');
