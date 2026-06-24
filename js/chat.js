// ============ ЛОГИКА ЧАТОВ ============
let currentChatId = null;
if (typeof dynamicChats === 'undefined') window.dynamicChats = {}; 
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
    if (window.socket && window.isConnected) {
        loadChatsAndMessages();
    } else {
        console.log('⏳ Сокет ещё не готов, повтор через 1 сек');
        setTimeout(initChats, 1000);
    }
}

// ============ ЗАГРУЗКА ЧАТОВ ============
function loadChatsAndMessages() {
    if (!window.socket || !window.isConnected) {
        console.log('⏳ Ожидание соединения...');
        setTimeout(loadChatsAndMessages, 1000);
        return;
    }

    console.log('📥 Загрузка чатов с сервера...');
    
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

    window.socket.emit('get_all_chats', {}, (chats) => {
        console.log('📨 Получены чаты от бэка:', chats?.length || 0);
        
        const chatsList = document.getElementById('chats-list');
        if (!chatsList) {
            console.error('❌ Элемент chats-list не найден!');
            return;
        }
        chatsList.innerHTML = '';
        
        // Рендерим служебные системные чаты по дефолту
        createChatRow(CONFIG.SUPPORT_ID, 'DICEGRAM SUPPORT', 'dicegram_support', true, 'private');
        createChatRow(CONFIG.BOTFATHER_ID, 'BotFather', 'botfather', false, 'private');
        
        if (chats && Array.isArray(chats)) {
            chats.forEach(chat => {
                // ФИКС: Учитываем, что бэкенд для групп может возвращать chat_id напрямую
                const partnerId = String(chat.chat_id || chat.partner_id);
                const chatType = chat.type || chat.chat_type || 'private';
                
                // Проверяем, чтобы мы случайно не продублировали саппорт/ботфазер или себя
                if (partnerId && partnerId !== window.MY_ID && 
                    partnerId !== String(CONFIG.SUPPORT_ID) && 
                    partnerId !== String(CONFIG.BOTFATHER_ID)) {
                    
                    if (!dynamicChats[partnerId]) {
                        dynamicChats[partnerId] = {
                            first_name: chat.name || chat.partner_name || `Чат ${partnerId}`,
                            username: chat.username || chat.partner_username || '',
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
                            previewEl.innerText = chat.last_message;
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
    const stringId = String(tgId);
    
    if (!dynamicChats[stringId]) {
        dynamicChats[stringId] = { 
            first_name: firstName || `ID ${stringId}`, 
            username: username || '',
            chat_type: chatType,
            is_verified: isVerified
        };
    } else {
        dynamicChats[stringId].is_verified = isVerified;
        dynamicChats[stringId].chat_type = chatType; // ФИКС: Всегда синхронизируем тип чата
    }
    
    const chatsList = document.getElementById('chats-list');
    if (!chatsList) return;
    
    // Если строка уже есть на экране, просто выходим
    if (document.getElementById(`chat-item-${stringId}`)) return;
    
    const isBotFather = username === 'botfather';
    const isSupport = stringId === String(CONFIG.SUPPORT_ID);
    const verified = isSupport || stringId === String(CONFIG.CREATOR_ID) || isVerified;
    const showVerifiedBadge = verified && chatType === 'private';
    
    const verifiedIcon = showVerifiedBadge ? BLUE_VERIFY_SVG : '';
    const displayName = firstName || `ID ${stringId}`;
    let avatarBg = 'linear-gradient(135deg, #5085b1, #366187)';
    
    if (isBotFather) {
        avatarBg = 'linear-gradient(135deg, #2a9d8f, #264653)';
    } else if (isSupport) {
        avatarBg = 'linear-gradient(135deg, #1e2c3a, #0f171e)'; 
    } else if (chatType === 'group') {
        avatarBg = 'linear-gradient(135deg, #e76f51, #f4a261)';
    } else if (chatType === 'channel') {
        avatarBg = 'linear-gradient(135deg, #2a9d8f, #264653)';
    }
    
    const rowHTML = `
        <div class="chat-item" id="chat-item-${stringId}" onclick="openChat('${stringId}')">
            <div class="chat-avatar" style="background: ${avatarBg}">
                ${displayName.substring(0,2).toUpperCase()}
                ${showVerifiedBadge ? '<span class="verified-badge">✅</span>' : ''}
            </div>
            <div class="chat-details">
                <div class="chat-title-row">
                    <div class="chat-name">${displayName} ${verifiedIcon}</div>
                    <div style="display:flex;align-items:center;gap:4px;">
                        <span class="chat-time" id="time-${stringId}"></span>
                        <span class="chat-unread-badge" id="unread-badge-${stringId}" style="display:none;">0</span>
                    </div>
                </div>
                <div class="chat-preview" id="preview-${stringId}">Нет сообщений</div>
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
    
    if (!window.socket || !window.isConnected) {
        alert('Нет соединения с сервером');
        return;
    }

    currentChatId = String(chatId);
    window.currentChatId = currentChatId; // Экспортируем в глобальный стейт
    renderedMessageIds.clear();
    
    unreadCounts[currentChatId] = 0;
    updateUnreadBadge(currentChatId, 0);
    
    const chatInfo = dynamicChats[currentChatId];
    const chatName = chatInfo ? chatInfo.first_name : `Чат ${currentChatId}`;
    const chatType = chatInfo ? chatInfo.chat_type : 'private';
    
    const titleEl = document.getElementById('chat-room-title');
    titleEl.innerText = chatName || 'Чат';
    
    if (chatInfo) {
        if (chatInfo.chat_type === 'group') titleEl.innerText = chatName || 'Группа';
        if (chatInfo.chat_type === 'channel') titleEl.innerText = chatName || 'Канал';
    }
    
    const messagesContainer = document.getElementById('chat-messages');
    messagesContainer.innerHTML = '';

    if (chatType === 'group' || chatType === 'channel') {
        window.socket.emit('join_chat', { chat_id: currentChatId }, (response) => {
            if (response && response.status === 'ok') console.log(`✅ Вошел в комнату сокетов: ${currentChatId}`);
        });
    }

    // Динамический рендер DICEGRAM SUPPORT
    if (currentChatId === String(CONFIG.SUPPORT_ID)) {
        titleEl.innerHTML = `DICEGRAM SUPPORT ${BLUE_VERIFY_SVG}`;
        document.getElementById('chat-room-status').innerText = 'официальный аккаунт';

        const finalId = window.MY_ID || 'Не определен';
        const finalName = window.tgUser?.first_name || 'Пользователь';
        const finalUsername = window.MY_USERNAME ? `@${window.MY_USERNAME}` : 'не установлен';

        const welcomeMsg = {
            id: 'welcome_msg_static',
            sender_id: CONFIG.SUPPORT_ID,
            receiver_id: finalId,
            text: `🚀 Вы успешно авторизовались в DICEGRAM!\n\n🆔 Ваш ID: ${finalId}\n👤 Никнейм: ${finalName}\n🏷️ Юзернейм: ${finalUsername}\n\n📱 Платформа работает стабильно в Mini App и внешнем приложении. Все сессии и созданные группы привязаны к вашему ID.`,
            timestamp: new Date().toISOString(),
            is_read: true
        };
        renderSingleMessageWithCheck(welcomeMsg);
    }

    window.socket.emit('get_user_info', { user_id: currentChatId }, (userInfo) => {
        if (userInfo && userInfo.status === 'found') {
            const isVerifiedUser = userInfo.user.is_verified || currentChatId === String(CONFIG.SUPPORT_ID) || currentChatId === String(CONFIG.CREATOR_ID);
            if (isVerifiedUser && currentChatId !== String(CONFIG.SUPPORT_ID)) {
                titleEl.innerHTML = `${titleEl.innerText} ${BLUE_VERIFY_SVG}`;
            }
            if (currentChatId !== String(CONFIG.SUPPORT_ID)) {
                document.getElementById('chat-room-status').innerText = userInfo.user.is_online ? '🟢 в сети' : 'был(а) недавно';
            }
        } else {
            if (chatInfo && (chatInfo.chat_type === 'group' || chatInfo.chat_type === 'channel')) {
                document.getElementById('chat-room-status').innerText = `${chatInfo.members_count || 0} участников`;
            }
        }
    });

    const bottomNav = document.getElementById('bottom-navigation');
    if (bottomNav) bottomNav.style.display = 'none';
    
    const chatRoom = document.getElementById('chat-room');
    if (chatRoom) chatRoom.style.display = 'flex';

    window.socket.emit('get_chat_history', { with_id: currentChatId }, (history) => {
        if (history && Array.isArray(history)) {
            history.forEach(msg => {
                if (currentChatId === String(CONFIG.SUPPORT_ID) && msg.text && msg.text.includes("Вы успешно авторизовались")) return; 
                renderSingleMessageWithCheck(msg);
            });
            scrollToBottom();
        }
    });

    window.socket.emit('mark_as_read', { chat_id: currentChatId });
}

// ============ ОТОБРАЖЕНИЕ СООБЩЕНИЯ ============
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

    const timeStr = getLocalTime(msg.timestamp);

    if (msg.sender_id === 'system') {
        msgEl.classList.add('system-message');
        msgEl.innerHTML = `<div class="system-message-content"><span>${msg.text}</span></div>`;
        wrapper.classList.add('system');
        wrapper.appendChild(msgEl);
        container.appendChild(wrapper);
        return;
    }

    let ticksHtml = '';
    if (msg.sender_id === window.MY_ID) {
        wrapper.classList.add('sent');
        msgEl.classList.add('sent');
        if (msg.is_read) {
            ticksHtml = `<span class="status-ticks read"><svg viewBox="0 0 24 24"><path d="M18 7l-1.41-1.41L10 12.17 7.41 9.59 6 11l4 4zm-4.24 0L12.35 5.59 6 11.94l1.41 1.41z" fill="currentColor"/></svg></span>`;
        } else {
            ticksHtml = `<span class="status-ticks sent"><svg viewBox="0 0 24 24"><path d="M18 7l-1.41-1.41L10 12.17 7.41 9.59 6 11l4 4" fill="currentColor"/></svg></span>`;
        }
    } else {
        wrapper.classList.add('received');
        msgEl.classList.add('received');
    }

    msgEl.innerHTML = `
        <span>${msg.text}</span>
        <div class="message-meta">
            <span class="message-time">${timeStr}</span>
            ${ticksHtml}
        </div>
    `;

    // Слушатели контекстных действий
    let longPressTimer = null;
    const startPress = () => longPressTimer = setTimeout(() => showMessageActions(msgId), 450);
    const clearPress = () => clearTimeout(longPressTimer);

    msgEl.addEventListener('mousedown', startPress);
    msgEl.addEventListener('mouseup', clearPress);
    msgEl.addEventListener('mouseleave', clearPress);
    msgEl.addEventListener('touchstart', startPress);
    msgEl.addEventListener('touchend', clearPress);

    wrapper.appendChild(msgEl);
    container.appendChild(wrapper);
}

// ============ ИСПРАВЛЕННАЯ ОБРАБОТКА ВХОДЯЩИХ ИВЕНТОВ ============
function handleNewMessage(msg) {
    if (!msg) return;
    console.log('📩 Обработка handleNewMessage в реальном времени:', msg);
    
    let chatId = String(msg.sender_id === window.MY_ID ? msg.receiver_id : (msg.chat_type === 'group' || msg.chat_type === 'channel' ? msg.receiver_id : msg.sender_id));
    
    // ФИКС: Если прилетает ивент от неизвестного чата/группы, мгновенно рендерим строку в списке
    if (!dynamicChats[chatId]) {
        const isGroup = msg.chat_type === 'group' || msg.chat_type === 'channel' || chatId.startsWith('group_') || chatId.startsWith('channel_');
        
        dynamicChats[chatId] = {
            first_name: msg.chat_name || (isGroup ? 'Группа DICEGRAM' : `Пользователь ${chatId}`),
            username: msg.chat_username || '',
            chat_type: msg.chat_type || (isGroup ? 'group' : 'private'),
            is_verified: false
        };
        
        createChatRow(chatId, dynamicChats[chatId].first_name, dynamicChats[chatId].username, false, dynamicChats[chatId].chat_type);
    }

    if (msg.sender_id === 'system') {
        if (currentChatId === chatId) {
            renderSingleMessageWithCheck(msg);
            scrollToBottom();
        }
        const previewEl = document.getElementById(`preview-${chatId}`);
        if (previewEl) previewEl.innerText = msg.text;
        return;
    }
    
    const isCurrentChat = currentChatId === chatId;
    if (isCurrentChat) {
        renderSingleMessageWithCheck(msg);
        scrollToBottom();
        if (msg.sender_id !== window.MY_ID) window.socket.emit('mark_as_read', { chat_id: chatId });
    } else {
        if (msg.sender_id !== window.MY_ID) {
            unreadCounts[chatId] = (unreadCounts[chatId] || 0) + 1;
            updateUnreadBadge(chatId, unreadCounts[chatId]);
        }
    }
    
    const previewEl = document.getElementById(`preview-${chatId}`);
    if (previewEl) previewEl.innerText = msg.text;
    
    const timeEl = document.getElementById(`time-${chatId}`);
    if (timeEl && msg.timestamp) timeEl.innerText = getLocalTime(msg.timestamp);
}

// ============ ОТПРАВКА СООБЩЕНИЯ ============
function toggleSendButton(input) {
    const btn = document.getElementById('send-btn-icon');
    if (btn) {
        if (input && input.value && input.value.trim().length > 0) btn.classList.add('active');
        else btn.classList.remove('active');
    }
}

function sendMessage() {
    const input = document.getElementById('message-field');
    if (!input) return;
    const text = input.value.trim();
    if (!text || !currentChatId) return;

    if (!window.socket || !window.isConnected) {
        alert('Нет соединения с сервером');
        return;
    }

    if (currentChatId === CONFIG.BOTFATHER_ID || (dynamicChats[currentChatId] && dynamicChats[currentChatId].username === 'botfather')) {
        if (typeof window.handleBotCommandStatic === 'function') {
            window.handleBotCommandStatic(text);
        } else {
            alert('Модуль ботов загружается...');
        }
        input.value = '';
        return;
    }

    sendMessageToServer(text);
}

function sendMessageToServer(text) {
    const input = document.getElementById('message-field');
    const tempId = 'temp_' + Date.now();
    
    const localMsg = {
        id: tempId,
        sender_id: window.MY_ID,
        receiver_id: currentChatId,
        text: text,
        timestamp: new Date().toISOString(),
        is_read: false
    };
    
    renderSingleMessageWithCheck(localMsg);
    scrollToBottom();
    
    window.socket.emit('send_message', { receiver_id: currentChatId, text: text }, (response) => {
        const tempEl = document.querySelector(`[data-message-id="${tempId}"]`);
        if (tempEl) tempEl.closest('.message-wrapper')?.remove();
        renderedMessageIds.delete(tempId);

        if (response && response.status === 'ok' && response.message) {
            renderSingleMessageWithCheck(response.message);
            scrollToBottom();
            const previewEl = document.getElementById(`preview-${currentChatId}`);
            if (previewEl) previewEl.innerText = text;
        } else {
            alert('❌ Ошибка отправки: ' + (response?.message || 'Сервер отклонил запрос'));
        }
    });

    input.value = '';
    const btn = document.getElementById('send-btn-icon');
    if (btn) btn.classList.remove('active');
    input.focus();
}

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
    if (!currentMessageId || !window.socket || !window.isConnected) return;
    window.socket.emit('add_reaction', { message_id: currentMessageId, reaction: emoji }, (response) => {
        if (response && response.status === 'ok' && response.reactions) {
            updateReactionDisplayDirect(currentMessageId, response.reactions);
        }
    });
    hideReactionPicker();
}

function updateReactionDisplayDirect(messageId, reactions) {
    const msgEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!msgEl) return;
    let container = msgEl.querySelector('.reactions') || document.createElement('div');
    if (!msgEl.querySelector('.reactions')) {
        container.className = 'reactions';
        msgEl.appendChild(container);
    } else container.innerHTML = '';
    
    if (!reactions || reactions.length === 0) {
        container.style.display = 'none';
        return;
    }
    container.style.display = 'flex';
    const grouped = {};
    reactions.forEach(r => { if (!grouped[r.reaction]) grouped[r.reaction] = []; grouped[r.reaction].push(r.user_id); });
    Object.entries(grouped).forEach(([emoji, users]) => {
        const span = document.createElement('span');
        span.className = 'reaction-item';
        span.innerHTML = `${emoji} <span class="count">${users.length}</span>`;
        container.appendChild(span);
    });
}

function showMessageActions(messageId) {
    const msgEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!msgEl) return;
    const isSent = msgEl.closest('.message-wrapper').classList.contains('sent');
    const actions = document.getElementById('message-actions');
    if (!actions) return;
    
    const baseButtons = `
        <button class="message-action-btn" onclick="replyToMessage()">↩ Ответить</button>
        <button class="message-action-btn" onclick="copyMessage()">📋 Копировать</button>
        <button class="message-action-btn" onclick="showReactionPicker('${messageId}')">😊 Реакция</button>
    `;
    
    actions.innerHTML = isSent ? baseButtons + `
        <button class="message-action-btn" onclick="editMessage()">✏️ Изменить</button>
        <button class="message-action-btn danger" onclick="deleteMessage()">🗑 Удалить</button>
    ` : baseButtons;
    
    actions.classList.toggle('active');
    selectedMessageId = messageId;
}

function copyMessage() {
    const msgEl = document.querySelector(`[data-message-id="${selectedMessageId}"]`);
    if (msgEl) {
        navigator.clipboard.writeText(msgEl.querySelector('span').innerText);
    }
    const actions = document.getElementById('message-actions');
    if (actions) actions.classList.remove('active');
}

function scrollToBottom() {
    const container = document.getElementById('chat-messages');
    if (container) container.scrollTop = container.scrollHeight;
}

function getLocalTime(isoString) {
    if (!isoString) return '';
    try {
        const d = new Date(isoString);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch(e) { return ''; }
}

// ФИКС: Экспортируем функции в глобальную зону window, чтобы к ним имели доступ другие файлы (socket.js и app.js)
window.loadChatsAndMessages = loadChatsAndMessages;
window.handleNewMessage = handleNewMessage;
window.createChatRow = createChatRow;
window.openChat = openChat;
window.sendMessage = sendMessage;
window.updateReactionDisplayDirect = updateReactionDisplayDirect;
window.scrollToBottom = scrollToBottom;

// Запуск модуля чатов
setTimeout(initChats, 500);
console.log('✅ Модуль чатов полностью обновлен, экспортирован в глобальный стейт и защищен');
