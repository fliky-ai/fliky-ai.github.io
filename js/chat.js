// ============ ЛОГИКА ЧАТОВ ============
let currentChatId = null;
let dynamicChats = {};
let unreadCounts = {};
let selectedMessageId = null;
let isInitialLoad = true;

// ... (остальной код без изменений)

// Действия с сообщениями (только для своих сообщений)
function showMessageActions(messageId) {
    const msgEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!msgEl) return;
    
    // Проверяем, чье это сообщение
    const wrapper = msgEl.closest('.message-wrapper');
    const isSent = wrapper.classList.contains('sent');
    
    // Только свои сообщения можно редактировать и удалять
    if (!isSent) {
        // Чужое сообщение - только ответить, переслать, копировать
        const actions = document.getElementById('message-actions');
        actions.innerHTML = `
            <button class="message-action-btn" onclick="replyToMessage()">↩ Ответить</button>
            <button class="message-action-btn" onclick="forwardMessage()">📤 Переслать</button>
            <button class="message-action-btn" onclick="copyMessage()">📋 Копировать</button>
        `;
        actions.classList.toggle('active');
        selectedMessageId = messageId;
        return;
    }
    
    // Свое сообщение - все действия
    const actions = document.getElementById('message-actions');
    actions.innerHTML = `
        <button class="message-action-btn" onclick="replyToMessage()">↩ Ответить</button>
        <button class="message-action-btn" onclick="forwardMessage()">📤 Переслать</button>
        <button class="message-action-btn" onclick="copyMessage()">📋 Копировать</button>
        <button class="message-action-btn" onclick="editMessage()">✏️ Изменить</button>
        <button class="message-action-btn danger" onclick="deleteMessage()">🗑 Удалить</button>
        <button class="message-action-btn" onclick="pinMessage()">📌 Закрепить</button>
    `;
    actions.classList.toggle('active');
    selectedMessageId = messageId;
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

// ... (остальной код без изменений)
