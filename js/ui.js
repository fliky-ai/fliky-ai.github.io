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
    document.getElementById('search-results').style.display = 'none';
    
    if (tabName === 'contacts') {
        loadContacts();
    }
}

function toggleTheme() {
    const root = document.documentElement;
    if (theme === 'dark') {
        root.setAttribute('data-theme', 'light');
        theme = 'light';
        document.querySelector('.theme-switch').innerText = '☀️';
    } else {
        root.removeAttribute('data-theme');
        theme = 'dark';
        document.querySelector('.theme-switch').innerText = '🌙';
    }
}

function showMessageActions(messageId) {
    const actions = document.getElementById('message-actions');
    if (actions) {
        actions.classList.toggle('active');
        selectedMessageId = messageId;
    }
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
                    msgEl.querySelector('span').innerHTML = formatMessageText(newText.trim());
                }
            }
        });
    }
    document.getElementById('message-actions').classList.remove('active');
}

function deleteMessage() {
    if (confirm('🗑 Удалить сообщение?')) {
        socket.emit('delete_message', { message_id: selectedMessageId }, (response) => {
            if (response && response.status === 'ok') {
                const msgEl = document.querySelector(`[data-message-id="${selectedMessageId}"]`);
                if (msgEl) {
                    msgEl.closest('.message-wrapper').remove();
                }
            }
        });
    }
    document.getElementById('message-actions').classList.remove('active');
}

function pinMessage() {
    socket.emit('pin_message', { message_id: selectedMessageId }, (response) => {
        if (response && response.status === 'ok') {
            alert('📌 Сообщение закреплено');
        }
    });
    document.getElementById('message-actions').classList.remove('active');
}