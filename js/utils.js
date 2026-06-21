function getLocalTime(timestamp) {
    try {
        const date = new Date(timestamp);
        if (isNaN(date.getTime())) return '--:--';
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
        return '--:--';
    }
}

function formatMessageText(text) {
    if (!text) return '';
    text = text.replace(/(@[a-zA-Z0-9_]{3,32})/g, function(match) {
        return `<span class="mention-link" onclick="window.handleMentionClick('${match}')">${match}</span>`;
    });
    text = text.replace(/(d\.me\/[a-zA-Z0-9_]+)/g, function(match) {
        return `<a href="#" class="link" onclick="window.handleLinkClick('${match}')">${match}</a>`;
    });
    return text;
}

function getAvatarColor(name) {
    const colors = ['#5085b1', '#366187', '#2a9d8f', '#264653', '#e76f51', '#f4a261', '#e9c46a'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
}

function scrollToBottom() {
    const container = document.getElementById('chat-messages');
    if (container) {
        container.scrollTop = container.scrollHeight;
    }
}

function handleLinkClick(link) {
    const username = link.replace('d.me/', '');
    window.handleMentionClick('@' + username);
}
