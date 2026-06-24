// ============ ЛОГИКА ЧАТОВ (ПОЛНАЯ ИСПРАВЛЕННАЯ ВЕРСИЯ) ============
let currentChatId = null;
let dynamicChats = {};
let unreadCounts = {};
let selectedMessageId = null;
let isInitialLoad = true;
let chatsLoaded = false;

// ============ РЕАКЦИИ ============
let currentMessageId = null;
const REACTIONS = ['👍', '❤️', '🔥', '😂', '😮', '😢'];
let reactionPickerTimeout = null;

const BLUE_VERIFY_SVG = `<svg class="tg-verify-icon" style="width:16px;height:16px;fill:#2f8cc9;vertical-align:middle;margin-left:4px;" viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>`;

let renderedMessageIds = new Set();

// ============ ИНИЦИАЛИЗАЦИЯ ЧАТОВ ============
function initChats() {
    console.log('🔄 initChats() вызван');
    if (typeof socket !== 'undefined' && isConnected) {
        loadChatsAndMessages();
    } else {
        console.log('⏳ Сокет ещё не готов, повтор через 1 сек');
        setTimeout(initChats, 1000);
    }
}

// ============ ЗАГРУЗКА ЧАТОВ ============
function loadChatsAndMessages() {
    if (typeof socket === 'undefined' || !isConnected) {
        console.log('⏳ Ожидание соединения для загрузки чатов...');
        setTimeout(loadChatsAndMessages, 1000);
        return;
    }

    console.log('📥 Загрузка чатов с сервера...');
    
    if (typeof CONFIG !== 'undefined') {
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
    }

    socket.emit('get_all_chats', {}, (chats) => {
        console.log('📨 Получены чаты:', chats?.length || 0);
        
        const chatsList = document.getElementById('chats-list');
        if (!chatsList) {
            console.error('❌ Элемент chats-list не найден!');
            return;
        }
        chatsList.innerHTML = '';
        
        // Всегда добавляем SUPPORT и BOTFATHER, если CONFIG доступен
        if (typeof CONFIG !== 'undefined') {
            createChatRow(CONFIG.SUPPORT_ID, 'DICEGRAM SUPPORT', 'dicegram_support', true);
            createChatRow(CONFIG.BOTFATHER_ID, 'BotFather', 'botfather', false);
        }
        
        if (chats && Array.isArray(chats)) {
            chats.forEach(chat => {
                const partnerId = chat.chat_id || chat.partner_id;
                const chatType = chat.type || 'private';
                
                if (typeof CONFIG !== 'undefined' && (partnerId === CONFIG.SUPPORT_ID || partnerId === CONFIG.BOTFATHER_ID)) {
                    return; // Пропускаем системные, они уже созданы выше
                }

                if (partnerId && partnerId !== MY_ID) {
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
    
    const isBotFather = username === 'botfather';
    const isSupport = typeof CONFIG !== 'undefined' && tgId === CONFIG.SUPPORT_ID;
    const isCreator = typeof CONFIG !== 'undefined' && tgId === CONFIG.CREATOR_ID;
    const verified = isSupport || isCreator || isVerified;
    
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
    if (!chatId) return;
    
    if (typeof socket === 'undefined' || !isConnected) {
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
    if (titleEl) {
        titleEl.innerText = chatName || 'Чат';
        if (chatInfo) {
            if (chatInfo.chat_type === 'group') titleEl.innerText = '👥 ' + (chatName || 'Группа');
            if (chatInfo.chat_type === 'channel') titleEl.innerText = '📢 ' + (chatName || 'Канал');
        }
    }
    
    const messagesContainer = document.getElementById('chat-messages');
    if (messagesContainer) messagesContainer.innerHTML = '';

    if (chatType === 'group' || chatType === 'channel') {
        socket.emit('join_chat', { chat_id: chatId }, (response) => {
            if (response?.status === 'ok') console.log(`✅ Вошел в комнату: ${chatId}`);
        });
    }

    // Приветствие SUPPORT
    if (typeof CONFIG !== 'undefined' && chatId === CONFIG.SUPPORT_ID) {
        if (titleEl) titleEl.innerHTML = `DICEGRAM SUPPORT ${BLUE_VERIFY_SVG}`;
        const statusEl = document.getElementById('chat-room-status');
        if (statusEl) statusEl.innerText = 'официальный аккаунт';

        const tgUserData = window.Telegram?.WebApp?.initDataUnsafe?.user;
        const finalName = tgUserData?.first_name || window.tgUser?.first_name || 'Пользователь';
        const finalUsername = tgUserData?.username || window.tgUser?.username || 'не установлен';
        const finalId = tgUserData?.id || MY_ID || '8771009385';

        const welcomeMsg = {
            id: 'welcome_msg_static',
            sender_id: CONFIG.SUPPORT_ID,
            receiver_id: finalId,
            text: `👋 Добро пожаловать в DICEGRAM!\n\n🆔 Ваш ID: ${finalId}\n👤 Имя: ${finalName}\n🏷️ Username: @${finalUsername}\n\n📱 DICEGRAM — копия Telegram. Все данные сохраняются на сервере.\n\n💬 Напишите нам, если возникли вопросы.`,
            timestamp: new Date().toISOString(),
            is_read: true
        };
        renderSingleMessageWithCheck(welcomeMsg);
    }

    socket.emit('get_user_info', { user_id: chatId }, (userInfo) => {
        if (userInfo && userInfo.status === 'found') {
            const isVerifiedUser = userInfo.user.is_verified || (typeof CONFIG !== 'undefined' && (chatId === CONFIG.SUPPORT_ID || chatId === CONFIG.CREATOR_ID));
            if (isVerifiedUser && chatId !== CONFIG.SUPPORT_ID && titleEl) {
                titleEl.innerHTML = `${titleEl.innerText} ${BLUE_VERIFY_SVG}`;
            }
            const statusEl = document.getElementById('chat-room-status');
            if (statusEl && chatId !== CONFIG.SUPPORT_ID) {
                statusEl.innerText = userInfo.user.is_online ? '🟢 в сети' : 'был(а) недавно';
            }
        } else {
            const statusEl = document.getElementById('chat-room-status');
            if (statusEl && chatInfo && (chatInfo.chat_type === 'group' || chatInfo.chat_type === 'channel')) {
                statusEl.innerText = `${chatInfo.members_count || 0} участников`;
            }
        }
    });

    const bottomNav = document.getElementById('bottom-navigation');
    const chatRoom = document.getElementById('chat-room');
    if (bottomNav) bottomNav.style.display = 'none';
    if (chatRoom) chatRoom.style.display = 'flex';

    socket.emit('get_chat_history', { with_id: chatId }, (history) => {
        if (history && Array.isArray(history)) {
            history.forEach(msg => {
                if (typeof CONFIG !== 'undefined' && chatId === CONFIG.SUPPORT_ID && msg.text && msg.text.includes("Добро пожаловать в DICEGRAM!")) {
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

    const timeStr = typeof getLocalTime === 'function' ? getLocalTime(msg.timestamp) : new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

    if (msg.sender_id === 'system') {
        msgEl.classList.add('system-message');
        msgEl.innerHTML = `
            <div class="system-message-content">
                <span>${typeof formatMessageText === 'function' ? formatMessageText(msg.text) : msg.text}</span>
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
        } else {
            ticksHtml = `<span class="status-ticks sent"><svg viewBox="0 0 24 24"><path d="M18 7l-1.41-1.41L10 12.17 7.41 9.59 6 11l4 4z"/><path d="M0 0h24v24H0z" fill="none"/></svg></span>`;
        }
    } else {
        wrapper.classList.add('received');
        msgEl.classList.add('received');
    }

    const formattedText = typeof formatMessageText === 'function' ? formatMessageText(msg.text) : msg.text;

    msgEl.innerHTML = `
        <span>${formattedText}</span>
        <div class="message-meta">
            <span class="message-time">${timeStr}</span>
            ${ticksHtml}
        </div>
    `;

    // Универсальный лонгпресс для тачей и мышки
    let longPressTimer = null;
    const startPress = () => { longPressTimer = setTimeout(() => showMessageActions(msgId), 500); };
    const cancelPress = () => clearTimeout(longPressTimer);

    msgEl.addEventListener('mousedown', startPress);
    msgEl.addEventListener('mouseup', cancelPress);
    msgEl.addEventListener('mouseleave', cancelPress);
    msgEl.addEventListener('touchstart', startPress);
    msgEl.addEventListener('touchend', cancelPress);
    msgEl.addEventListener('touchmove', cancelPress);

    wrapper.appendChild(msgEl);
    container.appendChild(wrapper);
}

// ============ ПРОВЕРКА ПРАВ В КАНАЛЕ ============
function checkChannelPermission(chatId) {
    if (typeof socket === 'undefined') return;
    socket.emit('check_channel_permission', { chat_id: chatId }, (response) => {
        if (response?.status === 'ok') {
            const input = document.getElementById('message-field');
            const sendBtn = document.getElementById('send-btn-icon');
            if (!input || !sendBtn) return;
            
            if (response.chat_type === 'channel' && !response.can_write) {
                input.disabled = true;
                input.placeholder = '📢 Канал доступен только для чтения';
                sendBtn.style.opacity = '0.3';
            } else {
                input.disabled = false;
                input.placeholder = 'Сообщение...';
                sendBtn.style.opacity = '1';
            }
        }
    });
}

// ============ ЗАКРЫТИЕ ЧАТА ============
function closeChat() {
    const room = document.getElementById('chat-room');
    const bottomNav = document.getElementById('bottom-navigation');
    if (room) room.style.display = 'none';
    if (bottomNav) bottomNav.style.display = 'flex';
    currentChatId = null;
    
    const input = document.getElementById('message-field');
    const sendBtn = document.getElementById('send-btn-icon');
    if (input) { input.disabled = false; input.placeholder = 'Сообщение...'; }
    if (sendBtn) sendBtn.style.opacity = '1';
}

// ============ ОБРАБОТКА НОВОГО СООБЩЕНИЯ ============
function handleNewMessage(msg) {
    console.log('📩 Новое входящее сообщение:', msg);
    if (!msg) return;

    let chatId = msg.receiver_id;
    if (msg.sender_id === MY_ID) {
        chatId = msg.receiver_id;
    } else if (msg.receiver_id === MY_ID) {
        chatId = msg.sender_id;
    }
    
    if (msg.sender_id === 'system') {
        if (currentChatId === msg.receiver_id) {
            renderSingleMessageWithCheck(msg);
            scrollToBottom();
        }
        const previewEl = document.getElementById(`preview-${msg.receiver_id}`);
        if (previewEl) previewEl.innerText = msg.text;
        return;
    }
    
    const isCurrentChat = currentChatId === chatId;
    if (isCurrentChat) {
        renderSingleMessageWithCheck(msg);
        scrollToBottom();
        if (msg.sender_id !== MY_ID && typeof socket !== 'undefined') {
            socket.emit('mark_as_read', { chat_id: chatId });
        }
    } else {
        if (msg.sender_id !== MY_ID) {
            unreadCounts[chatId] = (unreadCounts[chatId] || 0) + 1;
            updateUnreadBadge(chatId, unreadCounts[chatId]);
        }
    }
    
    const previewEl = document.getElementById(`preview-${chatId}`);
    if (previewEl) {
        let previewText = msg.text;
        const chatInfo = dynamicChats[chatId];
        if (chatInfo?.chat_type === 'group') previewText = '👥 ' + previewText;
        if (chatInfo?.chat_type === 'channel') previewText = '📢 ' + previewText;
        previewEl.innerText = previewText;
    }
    
    const timeEl = document.getElementById(`time-${chatId}`);
    if (timeEl && msg.timestamp) {
        timeEl.innerText = typeof getLocalTime === 'function' ? getLocalTime(msg.timestamp) : new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
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

    if (typeof socket === 'undefined' || !isConnected) {
        alert('Нет соединения с сервером');
        return;
    }

    if (typeof CONFIG !== 'undefined' && (currentChatId === CONFIG.BOTFATHER_ID || dynamicChats[currentChatId]?.username === 'botfather')) {
        handleBotCommand(text);
        input.value = '';
        document.getElementById('send-btn-icon')?.classList.remove('active');
        return;
    }

    sendMessageToServer(text);
}

function sendMessageToServer(text) {
    const input = document.getElementById('message-field');
    const tempId = 'temp_' + Date.now();
    
    const localMsg = {
        id: tempId,
        sender_id: MY_ID,
        receiver_id: currentChatId,
        text: text,
        timestamp: new Date().toISOString(),
        is_read: false
    };
    
    renderSingleMessageWithCheck(localMsg);
    scrollToBottom();
    
    socket.emit('send_message', { receiver_id: currentChatId, text: text }, (response) => {
        if (response?.status === 'ok') {
            const tempEl = document.querySelector(`[data-message-id="${tempId}"]`);
            if (tempEl) tempEl.closest('.message-wrapper')?.remove();
            renderedMessageIds.delete(tempId);
            
            if (response.message) {
                renderSingleMessageWithCheck(response.message);
                scrollToBottom();
            }
        } else {
            alert('❌ Ошибка отправки');
        }
    });

    if (input) input.value = '';
    document.getElementById('send-btn-icon')?.classList.remove('active');
}

// ============ УПРАВЛЕНИЕ РЕАКЦИЯМИ ============
function showReactionPicker(messageId) {
    currentMessageId = messageId;
    let picker = document.getElementById('reaction-picker');
    
    if (!picker) {
        picker = document.createElement('div');
        picker.id = 'reaction-picker';
        picker.className = 'reaction-picker';
        picker.innerHTML = REACTIONS.map(r => `<span class="reaction-emoji" data-reaction="${r}" onclick="addReaction('${r}')">${r}</span>`).join('');
        document.body.appendChild(picker);
    }
    
    const msgEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (msgEl) {
        const rect = msgEl.getBoundingClientRect();
        picker.style.left = `${Math.max(10, rect.left + rect.width / 2 - 110)}px`;
        picker.style.top = `${rect.top - 55 < 10 ? rect.bottom + 10 : rect.top - 55}px`;
        picker.style.display = 'flex';
    }
    
    clearTimeout(reactionPickerTimeout);
    reactionPickerTimeout = setTimeout(hideReactionPicker, 5000);
    document.getElementById('message-actions')?.classList.remove('active');
}

function hideReactionPicker() {
    const picker = document.getElementById('reaction-picker');
    if (picker) picker.style.display = 'none';
}

function addReaction(emoji) {
    if (!currentMessageId || typeof socket === 'undefined') return;
    
    socket.emit('add_reaction', { message_id: currentMessageId, reaction: emoji }, (response) => {
        if (response?.status === 'ok' && response.reactions) {
            updateReactionDisplayDirect(currentMessageId, response.reactions);
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

// ============ ДЕЙСТВИЯ С СООБЩЕНИЯМИ ============
function showMessageActions(messageId) {
    const msgEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!msgEl) return;
    
    const isSent = msgEl.closest('.message-wrapper')?.classList.contains('sent');
    const actions = document.getElementById('message-actions');
    if (!actions) return;
    
    let buttons = `
        <button class="message-action-btn" onclick="replyToMessage()">↩ Ответить</button>
        <button class="message-action-btn" onclick="forwardMessage()">📤 Переслать</button>
        <button class="message-action-btn" onclick="copyMessage()">📋 Копировать</button>
        <button class="message-action-btn" onclick="showReactionPicker('${messageId}')">😊 Реакция</button>
    `;
    
    if (isSent) {
        buttons += `
            <button class="message-action-btn" onclick="editMessage()">✏️ Изменить</button>
            <button class="message-action-btn danger" onclick="deleteMessage()">🗑 Удалить</button>
            <button class="message-action-btn" onclick="pinMessage()">📌 Закрепить</button>
        `;
    }
    
    actions.innerHTML = buttons;
    actions.classList.toggle('active');
    selectedMessageId = messageId;
}

function replyToMessage() {
    const text = prompt('Введите ответ:');
    if (text?.trim() && typeof socket !== 'undefined') {
        socket.emit('send_message', { receiver_id: currentChatId, text: text.trim(), reply_to_id: selectedMessageId });
    }
    document.getElementById('message-actions')?.classList.remove('active');
}

function forwardMessage() {
    const chatId = prompt('ID пользователя для пересылки:');
    if (chatId?.trim() && typeof socket !== 'undefined') {
        socket.emit('forward_message', { message_id: selectedMessageId, to_id: chatId.trim() }, (res) => {
            if (res?.status === 'ok') alert('✅ Переслано');
        });
    }
    document.getElementById('message-actions')?.classList.remove('active');
}

function copyMessage() {
    const msgEl = document.querySelector(`[data-message-id="${selectedMessageId}"]`);
    if (msgEl) {
        const span = msgEl.querySelector('span');
        if (span) navigator.clipboard.writeText(span.innerText).then(() => alert('📋 Скопировано'));
    }
    document.getElementById('message-actions')?.classList.remove('active');
}

function editMessage() {
    const newText = prompt('Новый текст:');
    if (newText?.trim() && typeof socket !== 'undefined') {
        socket.emit('edit_message', { message_id: selectedMessageId, text: newText.trim() }, (res) => {
            if (res?.status === 'ok') {
                const msgEl = document.querySelector(`[data-message-id="${selectedMessageId}"] <span>`);
                if (msgEl) msgEl.innerHTML = typeof formatMessageText === 'function' ? formatMessageText(newText.trim()) : newText.trim();
            }
        });
    }
    document.getElementById('message-actions')?.classList.remove('active');
}

function deleteMessage() {
    if (confirm('🗑 Удалить сообщение?') && typeof socket !== 'undefined') {
        socket.emit('delete_message', { message_id: selectedMessageId }, (res) => {
            if (res?.status === 'ok') document.querySelector(`[data-message-id="${selectedMessageId}"]`)?.closest('.message-wrapper')?.remove();
        });
    }
    document.getElementById('message-actions')?.classList.remove('active');
}

function pinMessage() {
    if (typeof socket !== 'undefined') {
        socket.emit('pin_message', { message_id: selectedMessageId }, (res) => {
            if (res?.status === 'ok') alert('📌 Закреплено');
        });
    }
    document.getElementById('message-actions')?.classList.remove('active');
}

function handleSearch(query) {
    const resultsContainer = document.getElementById('search-results');
    if (!resultsContainer) return;
    if (!query.trim()) { resultsContainer.style.display = 'none'; return; }

    if (typeof socket === 'undefined' || !isConnected) return;

    socket.emit('search_users', { query: query.trim() }, (results) => {
        resultsContainer.innerHTML = '';
        if (results && results.length > 0) {
            resultsContainer.style.display = 'block';
            results.forEach(user => {
                if (user.telegram_id === MY_ID) return;
                const item = document.createElement('div');
                item.className = 'search-result-item';
                const isVerified = typeof CONFIG !== 'undefined' && (user.telegram_id === CONFIG.CREATOR_ID || user.is_verified || user.telegram_id === CONFIG.SUPPORT_ID);
                
                item.innerHTML = `
                    <div class="chat-avatar" style="width:36px;height:36px;font-size:12px;background:linear-gradient(135deg, #5085b1, #366187)">
                        ${(user.first_name || 'U').substring(0,2).toUpperCase()}
                    </div>
                    <div>
                        <div style="display:flex;align-items:center;gap:4px;font-weight:600;">${user.first_name || 'User'} ${isVerified ? '✅' : ''}</div>
                        <div style="font-size:12px;color:var(--tg-text-secondary);">@${user.username || ''}</div>
                    </div>
                `;
                item.onclick = () => {
                    if (!dynamicChats[user.telegram_id]) {
                        createChatRow(user.telegram_id, user.first_name, user.username, isVerified);
                    }
                    openChat(user.telegram_id);
                    resultsContainer.style.display = 'none';
                    const sInput = document.getElementById('global-search');
                    if (sInput) sInput.value = '';
                };
                resultsContainer.appendChild(item);
            });
        } else {
            resultsContainer.style.display = 'block';
            resultsContainer.innerHTML = '<div style="padding:10px 14px;color:var(--tg-text-secondary);">Пользователи не найдены</div>';
        }
    });
}

function handleBotCommand(text) {
    const botResponse = emulateBotFather(text);
    const userMsg = { id: Date.now().toString(), sender_id: MY_ID, receiver_id: CONFIG.BOTFATHER_ID, text: text, timestamp: new Date().toISOString(), is_read: true };
    renderSingleMessageWithCheck(userMsg);
    
    setTimeout(() => {
        const botMsg = { id: (Date.now() + 1).toString(), sender_id: CONFIG.BOTFATHER_ID, receiver_id: MY_ID, text: botResponse, timestamp: new Date().toISOString(), is_read: true };
        renderSingleMessageWithCheck(botMsg);
        scrollToBottom();
    }, 500);
}

function emulateBotFather(text) {
    const lower = text.toLowerCase().trim();
    if (lower === '/start') return `I can help you create and manage Telegram bots... \n\n/newbot - create a new bot\n/mybots - edit your bots`;
    if (lower === '/newbot') return `Alright, a new bot. How are we going to call it? Please choose a name for your bot.`;
    return `Command processed. Keep building!`;
}

function scrollToBottom() {
    const container = document.getElementById('chat-messages');
    if (container) container.scrollTop = container.scrollHeight;
}

// Посадка функций на глобальный уровень window
window.initChats = initChats;
window.loadChatsAndMessages = loadChatsAndMessages;
window.openChat = openChat;
window.closeChat = closeChat;
window.sendMessage = sendMessage;
window.toggleSendButton = toggleSendButton;
window.handleNewMessage = handleNewMessage;
window.handleSearch = handleSearch;
window.showReactionPicker = showReactionPicker;
window.addReaction = addReaction;
window.replyToMessage = replyToMessage;
window.forwardMessage = forwardMessage;
window.copyMessage = copyMessage;
window.editMessage = editMessage;
window.deleteMessage = deleteMessage;
window.pinMessage = pinMessage;

// ============ СКРИПТЫ СЛУШАТЕЛЕЙ С БЕЗОПАСНЫМ ЗАПУСКОМ ============
function setupSocketListeners() {
    if (typeof socket !== 'undefined') {
        socket.on('reaction_updated', (data) => {
            if (data?.message_id && data.reactions) updateReactionDisplayDirect(data.message_id, data.reactions);
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
        
        socket.on('new_message', (msg) => {
            handleNewMessage(msg);
        });
        console.log('✅ Слушатели входящих событий сокета запущены');
    }
}

// Запускаем принудительно через полсекунды
setTimeout(() => {
    initChats();
    setupSocketListeners();
}, 500);

document.addEventListener('visibilitychange', function() {
    if (!document.hidden) initChats();
});

document.addEventListener('click', function(e) {
    const picker = document.getElementById('reaction-picker');
    if (picker && picker.style.display === 'flex' && !picker.contains(e.target)) hideReactionPicker();
});

console.log('✅ Модуль Chat полностью обновлен и связан с Auth!');
