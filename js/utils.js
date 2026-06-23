// ============ УТИЛИТЫ ============

// Локальное время
function getLocalTime(timestamp) {
    try {
        const date = new Date(timestamp);
        if (isNaN(date.getTime())) return '--:--';
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
        return '--:--';
    }
}

// ============ ПАРСИНГ ТЕКСТА (ССЫЛКИ И УПОМИНАНИЯ) ============
function formatMessageText(text) {
    if (!text) return '';
    
    let formatted = text;
    
    // 1. Обрабатываем dicegram.me ссылки
    formatted = formatted.replace(/(dicegram\.me\/[a-zA-Z0-9_]+)/g, function(match) {
        return `<a href="#" class="link dicegram-link" onclick="handleDicegramLink('${match}')">${match}</a>`;
    });
    
    // 2. Обрабатываем @упоминания
    formatted = formatted.replace(/(@[a-zA-Z0-9_]{3,32})/g, function(match) {
        return `<span class="mention-link" onclick="handleMentionClick('${match}')">${match}</span>`;
    });
    
    // 3. Обрабатываем обычные ссылки (http, https)
    formatted = formatted.replace(/(https?:\/\/[^\s]+)/g, function(match) {
        return `<a href="${match}" target="_blank" class="link">${match}</a>`;
    });
    
    return formatted;
}

// ============ ОБРАБОТКА ССЫЛОК DICEGRAM ============
function handleDicegramLink(link) {
    const code = link.replace('dicegram.me/', '').trim();
    if (!code) return;
    
    if (window.joinByInvite) {
        window.joinByInvite(code);
    } else {
        alert('🔗 Переход по ссылке: ' + link);
    }
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
                if (window.createChatRow) {
                    window.createChatRow(user.telegram_id, user.first_name || `User ${user.telegram_id}`, user.username || '', isVerified);
                }
            }
            if (window.openChat) {
                window.openChat(user.telegram_id, user.first_name || `User ${user.telegram_id}`, user.telegram_id === CONFIG.CREATOR_ID || user.is_verified);
            }
        } else {
            alert(`Пользователь ${username} не найден.`);
        }
    });
}

// ============ ГЕНЕРАЦИЯ ЦВЕТА АВАТАРКИ ============
function getAvatarColor(name) {
    const colors = ['#5085b1', '#366187', '#2a9d8f', '#264653', '#e76f51', '#f4a261', '#e9c46a'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
}

// ============ ПРОКРУТКА ============
function scrollToBottom() {
    const container = document.getElementById('chat-messages');
    if (container) {
        container.scrollTop = container.scrollHeight;
    }
}

// ============ ОБРАБОТКА ОБЫЧНЫХ ССЫЛОК ============
function handleLinkClick(link) {
    if (link.startsWith('dicegram.me/')) {
        handleDicegramLink(link);
    } else {
        window.open(link, '_blank');
    }
  }
