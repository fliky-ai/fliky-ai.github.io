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

// Форматирование текста
function formatMessageText(text) {
    if (!text) return '';
    // Упоминания
    text = text.replace(/(@[a-zA-Z0-9_]{3,32})/g, function(match) {
        return `<span class="mention-link" onclick="window.handleMentionClick('${match}')">${match}</span>`;
    });
    // Ссылки d.me
    text = text.replace(/(d\.me\/[a-zA-Z0-9_]+)/g, function(match) {
        return `<a href="#" class="link" onclick="window.handleLinkClick('${match}')">${match}</a>`;
    });
    return text;
}

// Генерация цвета аватарки
function getAvatarColor(name) {
    const colors = [
        '#5085b1', '#366187', '#2a9d8f', '#264653',
        '#e76f51', '#f4a261', '#e9c46a', '#2a9d8f'
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
}

// Скролл вниз
function scrollToBottom() {
    const container = document.getElementById('chat-messages');
    if (container) {
        container.scrollTop = container.scrollHeight;
    }
}

// Обработка ссылок
function handleLinkClick(link) {
    const username = link.replace('d.me/', '');
    window.handleMentionClick('@' + username);
}