// ============ ГЛОБАЛЬНОЕ СОСТОЯНИЕ (ОБЛАСТЬ ВИДИМОСТИ WINDOW) ============
window.MY_ID = window.MY_ID || null;
window.MY_USERNAME = window.MY_USERNAME || '';
window.currentChatId = null;
window.dynamicChats = window.dynamicChats || {};

// Локальное состояние для автономной работы UI, если сокеты отключены
let localMessages = {}; // Структура: { 'chat_id': [ { id, sender_id, text, timestamp }, ... ] }
let chatsLoaded = false;

// Конфиг системных ID (если еще не объявлен глобально)
window.CONFIG = window.CONFIG || {
    SUPPORT_ID: '0',
    BOTFATHER_ID: 'botfather',
    CREATOR_ID: '12345678'
};

// ============ ИНИЦИАЛИЗАЦИЯ И СЛУШАТЕЛИ СЕРВЕРА ============
document.addEventListener('DOMContentLoaded', () => {
    // Если сокет уже подключен, сразу грузим чаты
    if (typeof socket !== 'undefined' && isConnected) {
        loadChatsAndMessages();
    }
});

// Слушаем события успешного подключения от бэкенда (если они есть)
if (typeof socket !== 'undefined') {
    socket.on('connect', () => {
        setTimeout(loadChatsAndMessages, 500);
    });
    
    // Слушатель новых входящих сообщений от сервера
    socket.on('new_message', (data) => {
        if (!data) return;
        const chatId = data.chat_id || data.sender_id;
        
        // Сохраняем в локальную память
        if (!localMessages[chatId]) localMessages[chatId] = [];
        localMessages[chatId].push(data);
        
        // Если этот чат сейчас открыт — мгновенно рендерим на экране телефона
        if (window.currentChatId === String(chatId)) {
            appendMessageToDOM(data);
            scrollToBottom();
        } else {
            // Иначе подсвечиваем счетчик непрочитанных (визуально)
            updateChatUnreadBadge(chatId, 1);
        }
    });
}

// ============ 1. СПИСОК ЧАТОВ И ОБЯЗАТЕЛЬНЫЙ БОТ ============
function loadChatsAndMessages() {
    try {
        const chatsList = document.getElementById('chats-list');
        if (!chatsList) {
            console.log('⏳ Ожидание появления #chats-list в HTML...');
            setTimeout(loadChatsAndMessages, 500);
            return;
        }

        chatsList.innerHTML = ''; // Очищаем контейнер

        const supportId = window.CONFIG.SUPPORT_ID;
        const botfatherId = window.CONFIG.BOTFATHER_ID;

        // Железно прописываем системных ботов в глобальную память dynamicChats
        window.dynamicChats[supportId] = {
            first_name: 'DICEGRAM SUPPORT',
            username: 'dicegram_support',
            chat_type: 'private',
            is_verified: true
        };
        window.dynamicChats[botfatherId] = {
            first_name: 'BotFather',
            username: 'botfather',
            chat_type: 'private',
            is_verified: false
        };

        // 1. Сначала ВСЕГДА рендерим DICEGRAM SUPPORT на самом верху списка
        createChatRow(supportId, 'DICEGRAM SUPPORT', 'dicegram_support', true, 'private');
        // 2. Вторым рендерим BotFather
        createChatRow(botfatherId, 'BotFather', 'botfather', false, 'private');

        // 3. Запрашиваем остальные чаты у сервера
        if (typeof socket !== 'undefined' && isConnected) {
            socket.emit('get_all_chats', {}, (response) => {
                let chatsArray = [];
                if (response) {
                    if (Array.isArray(response)) chatsArray = response;
                    else if (response.chats && Array.isArray(response.chats)) chatsArray = response.chats;
                }

                chatsArray.forEach(chat => {
                    const partnerId = String(chat.chat_id || chat.partner_id || chat.telegram_id);
                    // Пропускаем дублирование суппорта, если он прилетел с базы
                    if (partnerId === supportId || partnerId === botfatherId) return;

                    // Сохраняем в глобальный реестр
                    window.dynamicChats[partnerId] = {
                        first_name: chat.name || chat.first_name || `User ${partnerId}`,
                        username: chat.username || '',
                        chat_type: chat.type || chat.chat_type || 'private',
                        is_verified: chat.is_verified || false
                    };

                    createChatRow(
                        partnerId, 
                        window.dynamicChats[partnerId].first_name, 
                        window.dynamicChats[partnerId].username, 
                        window.dynamicChats[partnerId].is_verified, 
                        window.dynamicChats[partnerId].chat_type
                    );
                });
                chatsLoaded = true;
            });
        } else {
            // Резервный режим (загрузка созданных локально групп из памяти, если сервер лежит)
            Object.keys(window.dynamicChats).forEach(id => {
                if (id !== supportId && id !== botfatherId) {
                    const c = window.dynamicChats[id];
                    createChatRow(id, c.first_name, c.username, c.is_verified, c.chat_type);
                }
            });
        }
    } catch (err) {
        console.error('Ошибка генерации списка чатов:', err);
    }
}

// Функция создания одной строки чата в DOM-дереве
function createChatRow(id, name, username, isVerified, type = 'private') {
    const chatsList = document.getElementById('chats-list');
    if (!chatsList) return;

    // Удаляем старую строку, если она существовала (защита от дубликатов)
    const oldRow = document.getElementById(`chat-item-${id}`);
    if (oldRow) oldRow.remove();

    const row = document.createElement('div');
    row.className = `chat-item ${window.currentChatId === String(id) ? 'active' : ''}`;
    row.id = `chat-item-${id}`;
    
    // Логика цвета аватарки
    let avatarStyle = 'background: linear-gradient(135deg, #5085b1, #366187);'; // ЛС
    if (type === 'group') avatarStyle = 'background: linear-gradient(135deg, #e76f51, #f4a261);';
    if (type === 'channel') avatarStyle = 'background: linear-gradient(135deg, #2a9d8f, #264653);';
    if (id === window.CONFIG.SUPPORT_ID) avatarStyle = 'background: linear-gradient(135deg, #007aff, #004080);';

    const initials = name ? name.substring(0, 2).toUpperCase() : 'CH';
    
    // Синяя галочка верификации через чистый SVG
    const verifiedBadge = isVerified ? `
        <span class="verified-check" style="display:inline-block; vertical-align:middle; width:14px; height:14px; margin-left:4px;">
            <svg viewBox="0 0 24 24" style="width:100%; height:100%;">
                <circle cx="12" cy="12" r="10" fill="#2f8cc9"/>
                <path d="M9 12l2 2 4-4" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
            </svg>
        </span>
    ` : '';

    row.innerHTML = `
        <div class="chat-avatar" style="${avatarStyle} width:45px; height:45px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:white; font-weight:bold; font-size:14px;">
            ${initials}
        </div>
        <div class="chat-info" style="flex:1; margin-left:12px; min-width:0;">
            <div class="chat-name-row" style="display:flex; align-items:center; justify-content:between;">
                <h4 style="margin:0; font-size:15px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${name}${verifiedBadge}</h4>
                <span class="chat-time" style="font-size:11px; color:var(--tg-text-secondary, #888);"></span>
            </div>
            <div class="chat-last-msg" style="font-size:13px; color:var(--tg-text-secondary, #888); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px;">
                ${username ? `@${username}` : (type === 'group' ? 'группа' : type === 'channel' ? 'канал' : 'нет сообщений')}
            </div>
        </div>
        <div class="chat-meta" style="display:flex; flex-direction:column; align-items:end; justify-content:center;">
            <span class="unread-badge" id="unread-${id}" style="display:none; background:#007aff; color:white; font-size:11px; padding:2px 6px; border-radius:10px; font-weight:bold; margin-top:4px;">0</span>
        </div>
    `;

    // Клик открывает чат
    row.onclick = () => openChat(id);
    chatsList.appendChild(row);
}

// ============ 2. ОКНО ЧАТА И ОТПРАВКА СООБЩЕНИЙ ============
function openChat(chatId) {
    if (!chatId) return;
    window.currentChatId = String(chatId);
    
    // Переключаем активный класс в списке чатов
    document.querySelectorAll('.chat-item').forEach(item => item.classList.remove('active'));
    const activeRow = document.getElementById(`chat-item-${chatId}`);
    if (activeRow) activeRow.classList.add('active');

    // Сбрасываем счетчик непрочитанных
    updateChatUnreadBadge(chatId, 0);

    const chatData = window.dynamicChats[chatId] || { first_name: `Чат ${chatId}`, chat_type: 'private' };

    // Подставляем данные в шапку чата
    const headerTitle = document.getElementById('chat-header-title');
    if (headerTitle) {
        const isVerified = chatId === window.CONFIG.SUPPORT_ID || chatData.is_verified;
        const verifiedBadge = isVerified ? `<span class="verified-check" style="display:inline-block; width:14px; height:14px; margin-left:4px;"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#2f8cc9"/><path d="M9 12l2 2 4-4" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></span>` : '';
        headerTitle.innerHTML = `<div style="cursor:pointer; display:inline-flex; align-items:center;" onclick="handleHeaderClick('${chatId}')">${chatData.first_name}${verifiedBadge}</div>`;
    }

    // Переключаем экран на окно сообщений (если это заложено в UI)
    if (typeof switchTab === 'function') {
        switchTab('messages'); 
    } else {
        const chatScreen = document.getElementById('screen-chat-window');
        if (chatScreen) chatScreen.classList.add('active');
    }

    // Очищаем и загружаем историю сообщений
    const msgContainer = document.getElementById('messages-container');
    if (msgContainer) msgContainer.innerHTML = '';

    if (!localMessages[chatId]) localMessages[chatId] = [];

    // Если подключен сервер — запрашиваем историю из базы данных
    if (typeof socket !== 'undefined' && isConnected) {
        socket.emit('get_chat_history', { chat_id: chatId }, (history) => {
            if (Array.isArray(history)) {
                localMessages[chatId] = history;
            }
            renderHistory(chatId);
        });
    } else {
        // Отрисовка из локальной памяти (офлайн режим)
        renderHistory(chatId);
    }
}

function renderHistory(chatId) {
    const msgContainer = document.getElementById('messages-container');
    if (!msgContainer || window.currentChatId !== String(chatId)) return;

    msgContainer.innerHTML = '';
    const messages = localMessages[chatId] || [];
    
    if (messages.length === 0) {
        msgContainer.innerHTML = `<div style="text-align:center; color:gray; margin-top:20px; font-size:13px;">Нет сообщений. Напишите первым!</div>`;
        return;
    }

    messages.forEach(msg => appendMessageToDOM(msg));
    scrollToBottom();
}

function appendMessageToDOM(msg) {
    const msgContainer = document.getElementById('messages-container');
    if (!msgContainer) return;

    // Проверяем, нет ли уже этого сообщения на экране
    if (document.querySelector(`[data-message-id="${msg.id || msg.message_id}"]`)) return;

    const wrapper = document.createElement('div');
    const isMy = String(msg.sender_id) === String(window.MY_ID);
    
    wrapper.className = `message-wrapper ${isMy ? 'my' : 'incoming'}`;
    wrapper.setAttribute('data-message-id', msg.id || msg.message_id || Math.random());
    
    // Экранирование текста против XSS
    const cleanText = (msg.text || '').replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const timeStr = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

    wrapper.innerHTML = `
        <div class="message-bubble" style="padding:8px 12px; border-radius:12px; max-width:75%; margin:4px 0; position:relative; word-break:break-word; ${isMy ? 'background:#5288c1; color:white; align-self:flex-end;' : 'background:var(--tg-theme-bg-color, #182533); color:var(--tg-theme-text-color, #fff); align-self:flex-start;'}">
            ${window.dynamicChats[window.currentChatId]?.chat_type !== 'private' && !isMy ? `<div style="font-size:11px; font-weight:bold; color:#f4a261; margin-bottom:2px;">User ${msg.sender_id}</div>` : ''}
            <span style="font-size:14px;">${cleanText}</span>
            <span style="font-size:9px; color:rgba(255,255,255,0.6); float:right; margin-top:5px; margin-left:8px;">${timeStr}</span>
        </div>
    `;
    
    // Событие долгого тапа/клика для вызова меню сообщения (из ui.js)
    wrapper.onclick = () => {
        if (typeof showMessageActions === 'function') showMessageActions(msg.id || msg.message_id);
    };

    msgContainer.appendChild(wrapper);
}

// Функция отправки текстового сообщения
function sendMessage() {
    const input = document.getElementById('message-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text || !window.currentChatId) return;

    input.value = ''; // Сразу очищаем поле

    const newMsg = {
        id: 'local_' + Date.now(),
        chat_id: window.currentChatId,
        sender_id: window.MY_ID || 'me',
        text: text,
        timestamp: new Date().toISOString()
    };

    // Отображаем у себя на телефоне мгновенно
    if (!localMessages[window.currentChatId]) localMessages[window.currentChatId] = [];
    localMessages[window.currentChatId].push(newMsg);
    appendMessageToDOM(newMsg);
    scrollToBottom();

    // Передаем по вебсокету на бэк на чистом Python
    if (typeof socket !== 'undefined' && isConnected) {
        socket.emit('send_message', {
            receiver_id: window.currentChatId,
            text: text
        }, (response) => {
            if (response && response.status === 'ok') {
                console.log('✅ Сообщение доставлено на сервер');
            }
        });
    }
}

// ============ 3. КНОПКА «+» И СОЗДАНИЕ ГРУПП/КАНАЛОВ ============
// Функция привязана к модальным окнам в ui.js. 
// Принимает тип 'group' или 'channel' и мгновенно создает локальный объект без ссылок!
function confirmCreate(type) {
    const input = document.getElementById('chat-name-input');
    if (!input) return;
    const name = input.value.trim();
    if (!name) return;
    
    if (typeof closeNameInput === 'function') closeNameInput();
    
    const tempChatId = 'group_' + Date.now(); // Локальный ID, пока сервер не ответит

    // Архитектурное требование: ссылки не генерируются, чат добавляется и сразу открывается!
    window.dynamicChats[tempChatId] = {
        first_name: name,
        username: '',
        chat_type: type, // 'group' или 'channel'
        members_count: 1,
        role: 'owner'
    };

    // Отрисовываем в списке
    createChatRow(tempChatId, name, '', false, type);
    // Автоматически сразу же открываем свежесозданный чат
    openChat(tempChatId);

    // Если сервер доступен — отправляем и синхронизируем временный ID с постоянным
    if (typeof socket !== 'undefined' && isConnected) {
        const eventName = type === 'group' ? 'create_group' : 'create_channel';
        socket.emit(eventName, { name: name }, (response) => {
            if (response && response.status === 'ok') {
                const realId = String(response.chat_id);
                
                // Переносим данные на реальный ID базы данных
                window.dynamicChats[realId] = { ...window.dynamicChats[tempChatId] };
                delete window.dynamicChats[tempChatId];
                
                // Перерисовываем строку с правильным ID
                const row = document.getElementById(`chat-item-${tempChatId}`);
                if (row) row.id = `chat-item-${realId}`;
                
                if (window.currentChatId === tempChatId) {
                    window.currentChatId = realId;
                }
                
                if (typeof showAlert === 'function') {
                    showAlert(`✅ ${type === 'group' ? 'Группа' : 'Канал'} "${name}" успешно создана!`);
                }
            }
        });
    }
}

// ============ 4. МЕНЮ ЧАТА И УЧАСТНИКИ ============
function handleHeaderClick(chatId) {
    if (!chatId) return;
    const chat = window.dynamicChats[chatId];
    if (!chat) return;

    // Если в системе подключен модуль профилей (profile.js) — делегируем вызов ему
    if (chat.chat_type === 'group' || chat.chat_type === 'channel') {
        if (typeof window.showGroupInfo === 'function') {
            window.showGroupInfo(chatId);
        } else if (typeof showGroupInfo === 'function') {
            showGroupInfo(chatId);
        } else {
            fallbackRenderGroupMenu(chatId);
        }
    } else {
        // Если это личный чат с пользователем или ботом
        if (typeof window.showUserProfile === 'function') {
            window.showUserProfile(chatId);
        } else if (typeof showUserProfile === 'function') {
            showUserProfile(chatId);
        }
    }
}

// Запасной локальный рендер меню группы, если profile.js не успел загрузиться
function fallbackRenderGroupMenu(chatId) {
    const chat = window.dynamicChats[chatId];
    const popup = document.getElementById('profile-popup') || document.createElement('div');
    
    if (!document.getElementById('profile-popup')) {
        popup.id = 'profile-popup';
        popup.className = 'profile-popup';
        document.body.appendChild(popup);
    }

    popup.innerHTML = `
        <div class="popup-content" style="padding:20px; background:var(--tg-theme-secondary-bg-color, #1f1f1f); border-radius:16px; color:white; max-width:90%; margin:auto; position:relative;">
            <button onclick="this.closest('.profile-popup').classList.remove('active')" style="position:absolute; right:15px; top:15px; background:none; border:none; color:white; font-size:18px;">✕</button>
            <div style="text-align:center; margin-bottom:15px;">
                <div style="width:70px; height:70px; border-radius:50%; background:linear-gradient(135deg, #e76f51, #f4a261); margin:auto; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:24px;">
                    ${(chat.first_name || 'CH').substring(0,2).toUpperCase()}
                </div>
                <h3 style="margin:10px 0 2px 0;">${chat.first_name}</h3>
                <p style="color:gray; font-size:12px; margin:0;">${chat.chat_type === 'group' ? '👥 Группа' : '📢 Канал'}</p>
            </div>
            <button onclick="if(typeof addGroupMember === 'function') addGroupMember()" style="width:100%; padding:10px; background:#007aff; border:none; color:white; border-radius:8px; font-weight:bold; margin-bottom:15px;">➕ Добавить участника</button>
            <div style="font-weight:bold; font-size:14px; margin-bottom:8px;">Список участников:</div>
            <div class="members-list" style="max-height:150px; overflow-y:auto;">
                <div style="display:flex; align-items:center; gap:10px; padding:5px 0;">
                    <div style="width:28px; height:28px; border-radius:50%; background:#888; display:flex; align-items:center; justify-content:center; font-size:11px;">Я</div>
                    <span style="font-size:13px;">Вы (Владелец)</span>
                </div>
            </div>
        </div>
    `;
    popup.classList.add('active');
}

// ============ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ УТИЛИТЫ ============
function updateChatUnreadBadge(chatId, count) {
    const badge = document.getElementById(`unread-${chatId}`);
    if (!badge) return;
    if (count > 0) {
        badge.innerText = count;
        badge.style.display = 'block';
    } else {
        badge.style.display = 'none';
    }
}

function scrollToBottom() {
    const container = document.getElementById('messages-container');
    if (container) {
        container.scrollTop = container.scrollHeight;
    }
}

console.log('✅ Модуль chat.js полностью обновлен и запущен в режиме WebApp!');
